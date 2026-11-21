import { useCallback, useEffect, useRef, useState } from 'react';
import { apiClient } from '@/services/api/client';
import { isProxxUnavailable } from '@/services/api/proxxShared';
import { proxxRequestsApi } from '@/services/api/proxxRequests';
import { useAuthStore } from '@/stores';
import type { RequestListPage, RequestRow } from '@/types/proxx';
import { getErrorMessage } from '@/utils/helpers';
import { mergeRows, rangeSince, type RequestFilters } from '../logic/requestLogic';

export type RequestsStatus = 'loading' | 'ready' | 'unavailable' | 'error';

export type RequestsMeta = Omit<RequestListPage, 'items' | 'nextCursor'>;

export interface RequestsListState {
  status: RequestsStatus;
  rows: RequestRow[];
  nextCursor: string;
  loadingMore: boolean;
  /** Set when loading the next page failed; auto-loading pauses until a retry or reload. */
  loadMoreError: boolean;
  refreshing: boolean;
  error: string;
  meta: RequestsMeta | null;
}

const filterQuery = (filters: RequestFilters) => ({
  status: filters.status,
  model: filters.model,
  provider: filters.provider,
  q: filters.q,
  since: rangeSince(filters.range),
});

/** Paged request list with stale-response guards (filter changes, connection switches). */
export function useRequestsList(filters: RequestFilters) {
  const connected = useAuthStore((state) => state.connectionStatus === 'connected');
  const apiBase = useAuthStore((state) => state.apiBase);
  const [state, setState] = useState<RequestsListState>({
    status: 'loading',
    rows: [],
    nextCursor: '',
    loadingMore: false,
    loadMoreError: false,
    refreshing: false,
    error: '',
    meta: null,
  });
  const requestRef = useRef(0);
  const filtersRef = useRef(filters);
  const stateRef = useRef(state);
  useEffect(() => {
    filtersRef.current = filters;
    stateRef.current = state;
  });

  const guard = () => {
    const id = ++requestRef.current;
    const revision = apiClient.getConnectionRevision();
    return () => id === requestRef.current && revision === apiClient.getConnectionRevision();
  };

  const reload = useCallback(async () => {
    if (!connected) return;
    const isCurrent = guard();
    setState((current) => ({ ...current, refreshing: true, loadingMore: false }));
    try {
      const page = await proxxRequestsApi.list(filterQuery(filtersRef.current));
      if (!isCurrent()) return;
      const { items, nextCursor, ...meta } = page;
      setState({
        status: 'ready',
        rows: items,
        nextCursor,
        loadingMore: false,
        loadMoreError: false,
        refreshing: false,
        error: '',
        meta,
      });
    } catch (error) {
      if (!isCurrent()) return;
      const unavailable = isProxxUnavailable(error);
      setState((current) => ({
        ...current,
        refreshing: false,
        status: unavailable ? 'unavailable' : current.status === 'ready' ? 'ready' : 'error',
        error: unavailable ? '' : getErrorMessage(error, 'Request failed'),
      }));
    }
  }, [connected]);

  const loadMore = useCallback(async () => {
    if (!connected) return;
    const { loadingMore, nextCursor: cursor } = stateRef.current;
    if (loadingMore || !cursor) return;
    stateRef.current = { ...stateRef.current, loadingMore: true, loadMoreError: false };
    setState((current) => ({ ...current, loadingMore: true, loadMoreError: false }));
    const id = requestRef.current;
    const revision = apiClient.getConnectionRevision();
    try {
      const page = await proxxRequestsApi.list({ ...filterQuery(filtersRef.current), cursor });
      if (id !== requestRef.current || revision !== apiClient.getConnectionRevision()) return;
      setState((current) => ({
        ...current,
        rows: [
          ...current.rows,
          ...page.items.filter((row) => !current.rows.some((r) => r.id === row.id)),
        ],
        nextCursor: page.nextCursor,
        loadingMore: false,
      }));
    } catch {
      if (id !== requestRef.current) return;
      setState((current) => ({
        ...current,
        loadingMore: false,
        loadMoreError: true,
      }));
    }
  }, [connected]);

  /** Merges rows that arrived from the live stream or polling. */
  const insertRows = useCallback((rows: RequestRow[]) => {
    if (!rows.length) return;
    setState((current) => ({ ...current, rows: mergeRows(current.rows, rows) }));
  }, []);

  const removeRow = useCallback((id: string) => {
    setState((current) => ({ ...current, rows: current.rows.filter((row) => row.id !== id) }));
  }, []);

  const setMeta = useCallback((patch: Partial<RequestsMeta>) => {
    setState((current) =>
      current.meta ? { ...current, meta: { ...current.meta, ...patch } } : current
    );
  }, []);

  /** First page with the current filters, without replacing the list (polling fallback). */
  const fetchLatest = useCallback(async (): Promise<RequestRow[]> => {
    const revision = apiClient.getConnectionRevision();
    const page = await proxxRequestsApi.list(filterQuery(filtersRef.current));
    if (revision !== apiClient.getConnectionRevision()) return [];
    const { items } = page;
    setMeta({
      requestLogEnabled: page.requestLogEnabled,
      totalSizeBytes: page.totalSizeBytes,
      maxTotalSizeBytes: page.maxTotalSizeBytes,
      logDir: page.logDir,
      ...(page.models.length || page.providers.length
        ? { models: page.models, providers: page.providers }
        : {}),
    });
    return items;
  }, [setMeta]);

  const filterKey = `${filters.status}|${filters.model}|${filters.provider}|${filters.q}|${filters.range}`;
  useEffect(() => {
    void reload();
  }, [reload, apiBase, filterKey]);

  useEffect(
    () => () => {
      requestRef.current += 1;
    },
    []
  );

  return { ...state, reload, loadMore, insertRows, removeRow, setMeta, fetchLatest };
}

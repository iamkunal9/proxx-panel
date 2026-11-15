import { useCallback, useEffect, useRef, useState } from 'react';
import { apiClient } from '@/services/api/client';
import {
  fillDailyUsage,
  proxxUsageApi,
  resolveUsageRange,
  type UsageRangePreset,
} from '@/services/api/proxxUsage';
import { isProxxUnavailable } from '@/services/api/proxxShared';
import { useAuthStore } from '@/stores';
import type { RecentUsageItem, UsageGroupBy, UsageRow, UsageSummary } from '@/types/proxx';
import { getErrorMessage } from '@/utils/helpers';

export type SpendStatus = 'loading' | 'ready' | 'unavailable' | 'error';

export interface SpendData {
  status: SpendStatus;
  refreshing: boolean;
  error: string;
  range: { from: string; to: string };
  daily: UsageSummary | null;
  series: UsageRow[];
  breakdown: UsageSummary | null;
  recent: RecentUsageItem[];
  refresh: () => Promise<void>;
}

interface Options {
  preset: UsageRangePreset;
  /** Breakdown dimension; omit to skip the breakdown request (dashboard strip). */
  groupBy?: Exclude<UsageGroupBy, 'day'>;
  recentLimit?: number;
}

export function useSpendData({ preset, groupBy, recentLimit = 0 }: Options): SpendData {
  const connected = useAuthStore((state) => state.connectionStatus === 'connected');
  const apiBase = useAuthStore((state) => state.apiBase);
  const [state, setState] = useState<Omit<SpendData, 'refresh' | 'range'>>({
    status: 'loading',
    refreshing: false,
    error: '',
    daily: null,
    series: [],
    breakdown: null,
    recent: [],
  });
  const requestRef = useRef(0);
  const [range, setRange] = useState(() => resolveUsageRange(preset));

  const load = useCallback(async () => {
    if (!connected) return;
    const requestId = ++requestRef.current;
    const revision = apiClient.getConnectionRevision();
    const isCurrent = () =>
      requestId === requestRef.current && revision === apiClient.getConnectionRevision();
    const nextRange = resolveUsageRange(preset);
    setRange(nextRange);
    setState((current) => ({
      ...current,
      refreshing: true,
      status: current.status === 'ready' ? 'ready' : 'loading',
    }));

    const [daily, breakdown, recent] = await Promise.allSettled([
      proxxUsageApi.getSummary({ ...nextRange, groupBy: 'day' }),
      groupBy ? proxxUsageApi.getSummary({ ...nextRange, groupBy }) : Promise.resolve(null),
      recentLimit > 0 ? proxxUsageApi.getRecent(recentLimit) : Promise.resolve([]),
    ]);
    if (!isCurrent()) return;

    if (daily.status === 'rejected') {
      const unavailable = isProxxUnavailable(daily.reason);
      setState((current) => ({
        ...current,
        refreshing: false,
        status: unavailable ? 'unavailable' : 'error',
        error: unavailable ? '' : getErrorMessage(daily.reason, 'Request failed'),
      }));
      return;
    }

    setState({
      status: 'ready',
      refreshing: false,
      error: '',
      daily: daily.value,
      series: fillDailyUsage(
        daily.value.rows,
        daily.value.from || nextRange.from,
        daily.value.to || nextRange.to
      ),
      breakdown: breakdown.status === 'fulfilled' ? breakdown.value : null,
      recent: recent.status === 'fulfilled' ? recent.value : [],
    });
  }, [connected, preset, groupBy, recentLimit]);

  useEffect(() => {
    void load();
  }, [load, apiBase]);

  useEffect(
    () => () => {
      requestRef.current += 1;
    },
    []
  );

  return { ...state, range, refresh: load };
}

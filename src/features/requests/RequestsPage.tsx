import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import { IconRefreshCw, IconSearch, IconTrash2, IconX } from '@/components/ui/icons';
import { ProxxError, ProxxSegmented, ProxxUnavailable } from '@/components/proxx/ProxxPage';
import { IconRequests } from '@/components/proxx/icons';
import { useHeaderRefresh } from '@/hooks/useHeaderRefresh';
import { useInterval } from '@/hooks/useInterval';
import { configApi } from '@/services/api/config';
import { proxxRequestsApi } from '@/services/api/proxxRequests';
import { useConfigStore, useNotificationStore } from '@/stores';
import type { RequestRow, RequestStatusFilter } from '@/types/proxx';
import { getErrorMessage } from '@/utils/helpers';
import { RequestDetail, type DetailTab } from './components/RequestDetail';
import { RequestList, type RequestListHandle } from './components/RequestList';
import { useRequestsList } from './hooks/useRequestsList';
import { useRequestStream } from './hooks/useRequestStream';
import {
  distinctValues,
  formatBytes,
  rowMatchesFilters,
  STATUS_FILTERS,
  TIME_RANGES,
  type RequestFilters,
  type TimeRange,
} from './logic/requestLogic';
import styles from './RequestsPage.module.scss';

const WIDTH_KEY = 'proxx.requests.detailWidth';
const LIVE_KEY = 'proxx.requests.live';
const MIN_DETAIL = 380;
const FRESH_MS = 1600;

const readStored = (key: string): string | null => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};
const writeStored = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Per-viewer convenience only.
  }
};

const isTypingTarget = (target: EventTarget | null) => {
  const element = target as HTMLElement | null;
  if (!element) return false;
  const tag = element.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || element.isContentEditable;
};

/** Buttons, links, tabs and other controls handle Enter/arrows themselves. */
const isInteractiveTarget = (target: EventTarget | null) =>
  Boolean(
    (target as HTMLElement | null)?.closest?.(
      'button, a, select, summary, [role="tab"], [role="radio"], [role="menuitem"], [role="separator"], aside'
    )
  );

export function RequestsPage() {
  const { t } = useTranslation();
  const showNotification = useNotificationStore((state) => state.showNotification);
  const showConfirmation = useNotificationStore((state) => state.showConfirmation);
  const confirmationOpen = useNotificationStore((state) => state.confirmation.isOpen);
  const updateConfigValue = useConfigStore((state) => state.updateConfigValue);
  const clearConfigCache = useConfigStore((state) => state.clearCache);

  const [status, setStatus] = useState<RequestStatusFilter>('');
  const [model, setModel] = useState('');
  const [provider, setProvider] = useState('');
  const [range, setRange] = useState<TimeRange>('24h');
  const [qInput, setQInput] = useState('');
  const [q, setQ] = useState('');
  const filters: RequestFilters = useMemo(
    () => ({ status, model, provider, q, range }),
    [status, model, provider, q, range]
  );

  const list = useRequestsList(filters);
  const { rows, meta, insertRows, reload } = list;

  const [live, setLive] = useState(() => readStored(LIVE_KEY) !== 'off');
  const [scrolled, setScrolled] = useState(false);
  const [pending, setPending] = useState<RequestRow[]>([]);
  const [freshIds, setFreshIds] = useState<Set<string>>(() => new Set());
  const [selectedId, setSelectedId] = useState('');
  const [openId, setOpenId] = useState('');
  const [tab, setTab] = useState<DetailTab>('transcript');
  const [now, setNow] = useState(() => Date.now());
  const [detailWidth, setDetailWidth] = useState(() => {
    const stored = Number(readStored(WIDTH_KEY));
    return Number.isFinite(stored) && stored >= MIN_DETAIL ? stored : 620;
  });
  const [toggling, setToggling] = useState(false);
  const [seen, setSeen] = useState<{ models: Set<string>; providers: Set<string> }>(() => ({
    models: new Set(),
    providers: new Set(),
  }));

  const listRef = useRef<RequestListHandle>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const splitRef = useRef<HTMLDivElement>(null);
  const liveState = useRef({ filters, scrolled, rows });
  useEffect(() => {
    liveState.current = { filters, scrolled, rows };
  });

  // Debounced server-side search.
  useEffect(() => {
    const timer = window.setTimeout(() => setQ(qInput.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [qInput]);

  // Filters changed: the list reloads, buffered live rows no longer apply.
  useEffect(() => {
    setPending([]);
  }, [status, model, provider, q, range]);

  // Remember model/provider values seen so far for the dropdowns.
  useEffect(() => {
    setSeen((current) => {
      let changed = false;
      const models = new Set(current.models);
      const providers = new Set(current.providers);
      for (const row of rows) {
        for (const value of [row.group, row.requestedModel, row.servedModel]) {
          if (value && !models.has(value)) {
            models.add(value);
            changed = true;
          }
        }
        if (row.provider && !providers.has(row.provider)) {
          providers.add(row.provider);
          changed = true;
        }
      }
      return changed ? { models, providers } : current;
    });
  }, [rows]);

  useInterval(() => setNow(Date.now()), 15_000);

  const markFresh = useCallback((ids: string[]) => {
    if (!ids.length) return;
    setFreshIds((current) => new Set([...current, ...ids]));
    window.setTimeout(() => {
      setFreshIds((current) => {
        const next = new Set(current);
        ids.forEach((id) => next.delete(id));
        return next;
      });
    }, FRESH_MS);
  }, []);

  const handleLiveRows = useCallback(
    (incoming: RequestRow[]) => {
      const { filters: active, scrolled: away, rows: current } = liveState.current;
      const known = new Set(current.map((row) => row.id));
      const matching = incoming.filter((row) => rowMatchesFilters(row, active));
      const updates = matching.filter((row) => known.has(row.id));
      const added = matching.filter((row) => !known.has(row.id));
      if (updates.length) insertRows(updates);
      if (!added.length) return;
      // Full-text search is server-side, and auto-insert pauses while the user is scrolled down.
      if (active.q || away) {
        setPending((buffer) => {
          const ids = new Set(buffer.map((row) => row.id));
          return [...added.filter((row) => !ids.has(row.id)), ...buffer];
        });
        return;
      }
      setNow(Date.now());
      insertRows(added);
      markFresh(added.map((row) => row.id));
    },
    [insertRows, markFresh]
  );

  const streamEnabled = live && list.status === 'ready' && !!meta?.requestLogEnabled;
  const streamStatus = useRequestStream({
    enabled: streamEnabled,
    onRows: handleLiveRows,
    poll: list.fetchLatest,
  });

  // Back at the top with buffered rows and no search: insert them.
  useEffect(() => {
    if (!scrolled && !q && pending.length) {
      insertRows(pending);
      markFresh(pending.map((row) => row.id));
      setPending([]);
    }
  }, [scrolled, q, pending, insertRows, markFresh]);

  const jumpToNew = () => {
    if (q) {
      setPending([]);
      void reload();
    }
    listRef.current?.scrollToTop();
  };

  useHeaderRefresh(reload, list.status !== 'unavailable');

  const setLiveMode = (value: boolean) => {
    setLive(value);
    writeStored(LIVE_KEY, value ? 'on' : 'off');
    if (value) void reload();
  };

  const toggleRequestLog = async (enabled: boolean) => {
    if (!meta) return;
    const previous = meta.requestLogEnabled;
    setToggling(true);
    list.setMeta({ requestLogEnabled: enabled });
    updateConfigValue('request-log', enabled);
    try {
      await configApi.updateRequestLog(enabled);
      clearConfigCache('request-log');
      showNotification(
        enabled ? t('proxx.requests.logging_enabled') : t('proxx.requests.logging_disabled'),
        'success'
      );
      await reload();
    } catch (error) {
      list.setMeta({ requestLogEnabled: previous });
      updateConfigValue('request-log', previous);
      showNotification(
        `${t('notification.update_failed')}: ${getErrorMessage(error, '')}`,
        'error'
      );
    } finally {
      setToggling(false);
    }
  };

  const handleClearAll = () => {
    showConfirmation({
      title: t('proxx.requests.clear_title'),
      message: t('proxx.requests.clear_message'),
      confirmText: t('proxx.requests.clear_confirm'),
      variant: 'danger',
      onConfirm: async () => {
        try {
          const removed = await proxxRequestsApi.clear();
          showNotification(t('proxx.requests.cleared', { count: removed }), 'success');
          setOpenId('');
          setSelectedId('');
          setPending([]);
          await reload();
        } catch (error) {
          showNotification(
            `${t('proxx.requests.clear_failed')}: ${getErrorMessage(error, '')}`,
            'error'
          );
        }
      },
    });
  };

  const handleDeleted = useCallback(
    (id: string) => {
      list.removeRow(id);
      setOpenId('');
    },
    [list]
  );

  const openRequest = useCallback((id: string) => setOpenId(id), []);
  const loadMoreFn = list.loadMore;
  const loadMore = useCallback(() => void loadMoreFn(), [loadMoreFn]);

  // Keyboard: `/` search, j/k move, Enter open, Esc close.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
      if (confirmationOpen) return;
      if (event.key === 'Escape') {
        if (isTypingTarget(event.target)) {
          (event.target as HTMLElement).blur();
          return;
        }
        if (openId) {
          event.preventDefault();
          setOpenId('');
        }
        return;
      }
      if (isTypingTarget(event.target)) return;
      if (event.key === '/') {
        event.preventDefault();
        searchRef.current?.focus();
        return;
      }
      const current = liveState.current.rows;
      if (!current.length) return;
      const index = current.findIndex((row) => row.id === selectedId);
      if (
        event.key === 'j' ||
        event.key === 'k' ||
        event.key === 'ArrowDown' ||
        event.key === 'ArrowUp'
      ) {
        // Arrow keys keep their native meaning on controls and while reading an open detail.
        if (
          (event.key === 'ArrowDown' || event.key === 'ArrowUp') &&
          (openId || isInteractiveTarget(event.target))
        ) {
          return;
        }
        event.preventDefault();
        const delta = event.key === 'j' || event.key === 'ArrowDown' ? 1 : -1;
        const next = Math.max(0, Math.min(current.length - 1, index === -1 ? 0 : index + delta));
        const id = current[next].id;
        setSelectedId(id);
        if (openId) setOpenId(id);
        listRef.current?.scrollToIndex(next);
        if (next >= current.length - 5) void list.loadMore();
      } else if (event.key === 'Enter' && index !== -1 && !isInteractiveTarget(event.target)) {
        event.preventDefault();
        setOpenId(current[index].id);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [selectedId, openId, confirmationOpen, list]);

  // Resizable split: drag the handle; the list keeps at least 320px.
  const startResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const container = splitRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const handle = event.currentTarget;
    handle.setPointerCapture(event.pointerId);
    const move = (moveEvent: PointerEvent) => {
      const width = Math.round(rect.right - moveEvent.clientX);
      setDetailWidth(Math.max(MIN_DETAIL, Math.min(rect.width - 320, width)));
    };
    const up = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      setDetailWidth((width) => {
        writeStored(WIDTH_KEY, String(width));
        return width;
      });
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
  };

  const resizeByKey = (delta: number) =>
    setDetailWidth((width) => {
      const next = Math.max(MIN_DETAIL, width + delta);
      writeStored(WIDTH_KEY, String(next));
      return next;
    });

  const openRow = useMemo(() => rows.find((row) => row.id === openId) ?? null, [rows, openId]);
  // Server facets cover every logged request in the range; seen adds rows that arrived live since.
  const modelOptions = distinctValues([...(meta?.models ?? []), ...seen.models], model);
  const providerOptions = distinctValues([...(meta?.providers ?? []), ...seen.providers], provider);
  const filtered = Boolean(status || model || provider || q || range !== 'all');
  // The default time range alone does not count as "filtering" for the logging-off empty state.
  const narrowed = Boolean(status || model || provider || q);
  const loggingOff = meta ? !meta.requestLogEnabled : false;

  if (list.status === 'unavailable') {
    return (
      <div className={styles.page}>
        <PageTitle />
        <ProxxUnavailable feature={t('proxx.requests.title')} />
      </div>
    );
  }

  const usage = meta?.totalSizeBytes ?? null;
  const max = meta?.maxTotalSizeBytes ?? 0;
  const usagePct = usage !== null && max > 0 ? Math.min(100, (usage / max) * 100) : 0;

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <PageTitle />
        <div className={styles.headerMeta}>
          {meta ? (
            <label className={`${styles.pill} ${loggingOff ? styles.pillOff : styles.pillOn}`}>
              <i className={styles.pillDot} aria-hidden="true" />
              <span>
                {loggingOff ? t('proxx.requests.logging_off') : t('proxx.requests.logging_on')}
              </span>
              <ToggleSwitch
                checked={!loggingOff}
                onChange={(value) => void toggleRequestLog(value)}
                disabled={toggling}
                ariaLabel={t('proxx.requests.logging_toggle')}
              />
            </label>
          ) : null}
          {meta ? (
            <div
              className={styles.disk}
              title={meta.logDir ? t('proxx.requests.log_dir', { dir: meta.logDir }) : undefined}
            >
              <span>
                {max > 0
                  ? t('proxx.requests.disk_of', { used: formatBytes(usage), max: formatBytes(max) })
                  : t('proxx.requests.disk_unlimited', { used: formatBytes(usage) })}
              </span>
              <span className={styles.diskBar} aria-hidden="true">
                <span
                  className={
                    usagePct > 90 ? `${styles.diskFill} ${styles.diskFillHot}` : styles.diskFill
                  }
                  style={{ width: max > 0 ? `${usagePct}%` : '0%' }}
                />
              </span>
            </div>
          ) : null}
        </div>
        <div className={styles.headerActions}>
          <button
            type="button"
            className={`${styles.liveBtn} ${live ? styles.liveOn : ''}`}
            aria-pressed={live}
            onClick={() => setLiveMode(!live)}
            title={
              live
                ? streamStatus === 'polling'
                  ? t('proxx.requests.live_polling')
                  : streamStatus === 'live'
                    ? t('proxx.requests.live_connected')
                    : t('proxx.requests.live_connecting')
                : t('proxx.requests.live_paused')
            }
          >
            <i
              className={`${styles.liveDot} ${streamStatus === 'live' || streamStatus === 'polling' ? styles.liveDotPulse : ''}`}
              aria-hidden="true"
            />
            {t('proxx.requests.live')}
          </button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void reload()}
            loading={list.refreshing && list.status === 'ready'}
            aria-label={t('proxx.common.refresh')}
            title={t('proxx.common.refresh')}
          >
            <IconRefreshCw size={14} />
          </Button>
          <Button variant="ghost" size="sm" onClick={handleClearAll} disabled={!rows.length}>
            <IconTrash2 size={14} />
            {t('proxx.requests.clear_all')}
          </Button>
        </div>
      </header>

      {list.status === 'error' ? (
        <ProxxError message={list.error} onRetry={() => void reload()} />
      ) : null}

      {loggingOff && list.status === 'ready' && rows.length === 0 && !narrowed ? (
        <LoggingOffState onEnable={() => void toggleRequestLog(true)} busy={toggling} />
      ) : (
        <>
          {loggingOff && list.status === 'ready' ? (
            <div className={styles.banner} role="status">
              <span>{t('proxx.requests.logging_off_banner')}</span>
              <button
                type="button"
                className={styles.bannerAction}
                onClick={() => void toggleRequestLog(true)}
                disabled={toggling}
              >
                {t('proxx.requests.enable')}
              </button>
            </div>
          ) : null}

          <div className={styles.filters}>
            <label className={styles.search}>
              <IconSearch size={14} />
              <input
                ref={searchRef}
                type="search"
                value={qInput}
                onChange={(event) => setQInput(event.target.value)}
                placeholder={t('proxx.requests.search_placeholder')}
                aria-label={t('proxx.requests.search_placeholder')}
              />
              {qInput ? (
                <button
                  type="button"
                  className={styles.clearSearch}
                  onClick={() => setQInput('')}
                  aria-label={t('proxx.requests.clear_search')}
                >
                  <IconX size={12} />
                </button>
              ) : (
                <kbd className={styles.kbd}>/</kbd>
              )}
            </label>
            <ProxxSegmented
              value={status || 'all'}
              options={STATUS_FILTERS.map((value) => ({
                value: value || 'all',
                label: t(`proxx.requests.status.${value || 'all'}`),
              }))}
              onChange={(value) => setStatus(value === 'all' ? '' : (value as RequestStatusFilter))}
              ariaLabel={t('proxx.requests.status_label')}
            />
            <select
              className={styles.select}
              value={model}
              onChange={(event) => setModel(event.target.value)}
              aria-label={t('proxx.requests.model_filter')}
            >
              <option value="">{t('proxx.requests.all_models')}</option>
              {modelOptions.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
            <select
              className={styles.select}
              value={provider}
              onChange={(event) => setProvider(event.target.value)}
              aria-label={t('proxx.requests.provider_filter')}
            >
              <option value="">{t('proxx.requests.all_providers')}</option>
              {providerOptions.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
            <ProxxSegmented
              value={range}
              options={TIME_RANGES.map((value) => ({
                value,
                label: t(`proxx.requests.range.${value}`),
              }))}
              onChange={setRange}
              ariaLabel={t('proxx.requests.range_label')}
            />
          </div>

          <div
            ref={splitRef}
            className={openId ? `${styles.split} ${styles.splitOpen}` : styles.split}
          >
            <div className={styles.listPane}>
              {pending.length ? (
                <button type="button" className={styles.newPill} onClick={jumpToNew}>
                  ↑ {t('proxx.requests.new_requests', { count: pending.length })}
                </button>
              ) : null}
              {list.status === 'loading' ? (
                <div className={styles.listSkeleton} aria-busy="true">
                  {Array.from({ length: 8 }, (_, index) => (
                    <i key={index} />
                  ))}
                </div>
              ) : (
                <RequestList
                  ref={listRef}
                  rows={rows}
                  selectedId={selectedId}
                  openId={openId}
                  freshIds={freshIds}
                  now={now}
                  hasMore={!!list.nextCursor}
                  loadingMore={list.loadingMore}
                  loadMoreError={list.loadMoreError}
                  onSelect={setSelectedId}
                  onOpen={openRequest}
                  onLoadMore={loadMore}
                  onScrolledChange={setScrolled}
                  emptyText={
                    filtered ? t('proxx.requests.empty_filtered') : t('proxx.requests.empty')
                  }
                />
              )}
              <div className={styles.hints} aria-hidden="true">
                <span>
                  <kbd className={styles.kbd}>j</kbd>
                  <kbd className={styles.kbd}>k</kbd> {t('proxx.requests.hint_move')}
                </span>
                <span>
                  <kbd className={styles.kbd}>↵</kbd> {t('proxx.requests.hint_open')}
                </span>
                <span>
                  <kbd className={styles.kbd}>esc</kbd> {t('proxx.requests.hint_close')}
                </span>
                <span className={styles.hintCount}>
                  {t('proxx.requests.loaded_count', { count: rows.length })}
                </span>
              </div>
            </div>
            {openId ? (
              <>
                <div
                  className={styles.resizer}
                  role="separator"
                  aria-orientation="vertical"
                  aria-label={t('proxx.requests.resize')}
                  aria-valuenow={detailWidth}
                  tabIndex={0}
                  onPointerDown={startResize}
                  onKeyDown={(event) => {
                    if (event.key === 'ArrowLeft') resizeByKey(24);
                    if (event.key === 'ArrowRight') resizeByKey(-24);
                  }}
                />
                <div className={styles.detailPane} style={{ width: detailWidth }}>
                  <RequestDetail
                    key={openId}
                    id={openId}
                    row={openRow}
                    tab={tab}
                    onTabChange={setTab}
                    onClose={() => setOpenId('')}
                    onDeleted={handleDeleted}
                  />
                </div>
              </>
            ) : null}
          </div>
        </>
      )}
    </div>
  );
}

function PageTitle() {
  const { t } = useTranslation();
  return (
    <h1 className={styles.title}>
      <span className={styles.titleIcon} aria-hidden="true">
        <IconRequests />
      </span>
      {t('proxx.requests.title')}
    </h1>
  );
}

function LoggingOffState({ onEnable, busy }: { onEnable: () => void; busy: boolean }) {
  const { t } = useTranslation();
  return (
    <div className={styles.offState}>
      <span className={styles.offIcon} aria-hidden="true">
        <IconRequests size={22} />
      </span>
      <h2>{t('proxx.requests.off_title')}</h2>
      <p>{t('proxx.requests.off_description')}</p>
      <ul>
        <li>{t('proxx.requests.off_point_content')}</li>
        <li>{t('proxx.requests.off_point_keys')}</li>
        <li>{t('proxx.requests.off_point_disk')}</li>
      </ul>
      <Button onClick={onEnable} loading={busy}>
        {t('proxx.requests.enable')}
      </Button>
    </div>
  );
}

import { forwardRef, memo, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ProxxBadge } from '@/components/proxx/ProxxPage';
import { DASH, formatLatency, formatUsd } from '@/components/proxx/format';
import type { RequestRow } from '@/types/proxx';
import {
  formatAbsolute,
  formatBytes,
  formatCount,
  formatRelative,
  modelChain,
  rowTimeMs,
  statusTone,
} from '../logic/requestLogic';
import styles from '../RequestsPage.module.scss';

export const ROW_HEIGHT = 40;
const OVERSCAN = 8;
const LOAD_MORE_THRESHOLD = 12;

export interface RequestListHandle {
  scrollToTop: () => void;
  scrollToIndex: (index: number) => void;
}

interface Props {
  rows: RequestRow[];
  selectedId: string;
  openId: string;
  freshIds: Set<string>;
  now: number;
  hasMore: boolean;
  loadingMore: boolean;
  onSelect: (id: string) => void;
  onOpen: (id: string) => void;
  onLoadMore: () => void;
  /** Reports whether the list is scrolled away from the top (pauses live insertion). */
  onScrolledChange: (scrolled: boolean) => void;
  emptyText: string;
}

const Row = memo(function Row({
  row,
  index,
  selected,
  open,
  fresh,
  now,
  onSelect,
  onOpen,
}: {
  row: RequestRow;
  index: number;
  selected: boolean;
  open: boolean;
  fresh: boolean;
  now: number;
  onSelect: (id: string) => void;
  onOpen: (id: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const time = rowTimeMs(row);
  const chain = modelChain(row);
  const className = [
    styles.row,
    selected ? styles.rowSelected : '',
    open ? styles.rowOpen : '',
    fresh ? styles.rowFresh : '',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <div
      role="row"
      id={`req-row-${row.id}`}
      aria-selected={selected}
      aria-rowindex={index + 2}
      className={className}
      style={{ top: index * ROW_HEIGHT }}
      onClick={() => {
        onSelect(row.id);
        onOpen(row.id);
      }}
    >
      <span role="gridcell" className={styles.cTime} title={formatAbsolute(time, i18n.language)}>
        {formatRelative(time, now)}
      </span>
      <span role="gridcell" className={styles.cStatus}>
        <ProxxBadge tone={statusTone(row)} dot>
          {row.status ?? (row.error ? t('proxx.requests.status_error') : DASH)}
        </ProxxBadge>
      </span>
      <span role="gridcell" className={styles.cPath} title={`${row.method} ${row.path}`}>
        <span className={styles.method}>{row.method || DASH}</span> {row.path || DASH}
      </span>
      <span
        role="gridcell"
        className={styles.cModel}
        title={chain.from ? `${chain.from} → ${chain.to}` : chain.to}
      >
        {chain.from ? (
          <>
            <span className={styles.muted}>{chain.from} → </span>
            {chain.to}
          </>
        ) : (
          chain.to || DASH
        )}
      </span>
      <span role="gridcell" className={styles.cProvider}>
        {row.provider || DASH}
      </span>
      <span role="gridcell" className={styles.cLatency}>
        {formatLatency(row.durationMs)}
      </span>
      <span
        role="gridcell"
        className={styles.cTokens}
        title={
          row.cachedTokens
            ? t('proxx.requests.cached_tokens', { count: row.cachedTokens })
            : undefined
        }
      >
        {formatCount(row.inputTokens)}
        <span className={styles.muted}> / </span>
        {formatCount(row.outputTokens)}
        {row.reasoningTokens ? (
          <span className={styles.reasoningTokens}> +{formatCount(row.reasoningTokens)}</span>
        ) : null}
      </span>
      <span role="gridcell" className={styles.cCost} title={row.costSource || undefined}>
        {formatUsd(row.costUsd)}
      </span>
      <span role="gridcell" className={styles.cBadges}>
        {row.stream ? <span className={styles.tag}>{t('proxx.requests.stream')}</span> : null}
        {row.attempts > 1 ? (
          <span className={`${styles.tag} ${styles.tagWarn}`}>
            {t('proxx.requests.attempts', { count: row.attempts })}
          </span>
        ) : null}
        <span className={styles.size}>{formatBytes(row.sizeBytes)}</span>
      </span>
    </div>
  );
});

/** Windowed request table (fixed row height) with infinite scroll. */
export const RequestList = forwardRef<RequestListHandle, Props>(function RequestList(
  {
    rows,
    selectedId,
    openId,
    freshIds,
    now,
    hasMore,
    loadingMore,
    onSelect,
    onOpen,
    onLoadMore,
    onScrolledChange,
    emptyText,
  },
  ref
) {
  const { t } = useTranslation();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [height, setHeight] = useState(600);
  const scrolledRef = useRef(false);

  useImperativeHandle(ref, () => ({
    scrollToTop: () => {
      if (scrollRef.current) scrollRef.current.scrollTop = 0;
    },
    scrollToIndex: (index: number) => {
      const element = scrollRef.current;
      if (!element) return;
      const top = index * ROW_HEIGHT;
      const bottom = top + ROW_HEIGHT;
      if (top < element.scrollTop) element.scrollTop = top;
      else if (bottom > element.scrollTop + element.clientHeight) {
        element.scrollTop = bottom - element.clientHeight;
      }
    },
  }));

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setHeight(element.clientHeight));
    observer.observe(element);
    setHeight(element.clientHeight);
    return () => observer.disconnect();
  }, []);

  const start = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const end = Math.min(rows.length, Math.ceil((scrollTop + height) / ROW_HEIGHT) + OVERSCAN);

  useEffect(() => {
    if (hasMore && !loadingMore && end >= rows.length - LOAD_MORE_THRESHOLD && rows.length > 0) {
      onLoadMore();
    }
  }, [end, rows.length, hasMore, loadingMore, onLoadMore]);

  return (
    <div
      className={styles.grid}
      role="grid"
      aria-label={t('proxx.requests.title')}
      aria-rowcount={rows.length + 1}
    >
      <div role="row" className={`${styles.row} ${styles.headRow}`} aria-rowindex={1}>
        <span role="columnheader" className={styles.cTime}>
          {t('proxx.requests.col.time')}
        </span>
        <span role="columnheader" className={styles.cStatus}>
          {t('proxx.requests.col.status')}
        </span>
        <span role="columnheader" className={styles.cPath}>
          {t('proxx.requests.col.request')}
        </span>
        <span role="columnheader" className={styles.cModel}>
          {t('proxx.requests.col.model')}
        </span>
        <span role="columnheader" className={styles.cProvider}>
          {t('proxx.requests.col.provider')}
        </span>
        <span role="columnheader" className={styles.cLatency}>
          {t('proxx.requests.col.latency')}
        </span>
        <span role="columnheader" className={styles.cTokens}>
          {t('proxx.requests.col.tokens')}
        </span>
        <span role="columnheader" className={styles.cCost}>
          {t('proxx.requests.col.cost')}
        </span>
        <span role="columnheader" className={styles.cBadges} />
      </div>
      <div
        ref={scrollRef}
        className={styles.gridScroll}
        onScroll={(event) => {
          const top = event.currentTarget.scrollTop;
          setScrollTop(top);
          const scrolled = top > ROW_HEIGHT / 2;
          if (scrolled !== scrolledRef.current) {
            scrolledRef.current = scrolled;
            onScrolledChange(scrolled);
          }
        }}
      >
        {rows.length === 0 ? (
          <div className={styles.emptyList}>{emptyText}</div>
        ) : (
          <div
            className={styles.gridInner}
            style={{ height: rows.length * ROW_HEIGHT + (hasMore ? ROW_HEIGHT : 0) }}
          >
            {rows.slice(start, end).map((row, offset) => (
              <Row
                key={row.id}
                row={row}
                index={start + offset}
                selected={row.id === selectedId}
                open={row.id === openId}
                fresh={freshIds.has(row.id)}
                now={now}
                onSelect={onSelect}
                onOpen={onOpen}
              />
            ))}
            {hasMore ? (
              <div className={styles.loadingRow} style={{ top: rows.length * ROW_HEIGHT }}>
                {loadingMore ? t('proxx.common.loading') : ''}
              </div>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
});

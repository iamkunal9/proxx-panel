import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { IconChevronDown, IconChevronUp, IconDownload, IconSearch } from '@/components/ui/icons';
import { searchLines } from '../logic/requestLogic';
import styles from './Detail.module.scss';

const LINE_HEIGHT = 19;
const OVERSCAN = 30;

function highlight(line: string, query: string, active: boolean): ReactNode {
  if (!query) return line || ' ';
  const lower = line.toLowerCase();
  const needle = query.toLowerCase();
  const nodes: ReactNode[] = [];
  let from = 0;
  let index = lower.indexOf(needle);
  while (index !== -1) {
    if (index > from) nodes.push(line.slice(from, index));
    nodes.push(
      <mark key={index} className={active ? styles.markActive : styles.mark}>
        {line.slice(index, index + needle.length)}
      </mark>
    );
    from = index + needle.length;
    index = lower.indexOf(needle, from);
  }
  if (from < line.length) nodes.push(line.slice(from));
  return nodes.length ? nodes : line || ' ';
}

/** Windowed monospace viewer for a raw request-log file, with in-panel search. */
export function RawViewer({
  text,
  fileName,
  autoFocus = false,
}: {
  text: string;
  fileName: string;
  autoFocus?: boolean;
}) {
  const { t } = useTranslation();
  const lines = useMemo(() => text.replace(/\r\n?/g, '\n').split('\n'), [text]);
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [hitIndex, setHitIndex] = useState(0);
  const [scrollTop, setScrollTop] = useState(0);
  const [height, setHeight] = useState(400);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(query), 150);
    return () => window.clearTimeout(timer);
  }, [query]);

  const hits = useMemo(() => searchLines(lines, debounced), [lines, debounced]);
  useEffect(() => setHitIndex(0), [debounced]);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setHeight(element.clientHeight));
    observer.observe(element);
    setHeight(element.clientHeight);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);

  const activeLine = hits.length ? hits[Math.min(hitIndex, hits.length - 1)] : -1;

  useEffect(() => {
    const element = scrollRef.current;
    if (!element || activeLine < 0) return;
    const top = activeLine * LINE_HEIGHT;
    if (
      top < element.scrollTop ||
      top > element.scrollTop + element.clientHeight - LINE_HEIGHT * 2
    ) {
      element.scrollTop = Math.max(0, top - element.clientHeight / 3);
    }
  }, [activeLine]);

  const step = useCallback(
    (delta: number) => {
      if (!hits.length) return;
      setHitIndex((current) => (current + delta + hits.length) % hits.length);
    },
    [hits.length]
  );

  const download = () => {
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = fileName || 'request.log';
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const start = Math.max(0, Math.floor(scrollTop / LINE_HEIGHT) - OVERSCAN);
  const end = Math.min(lines.length, Math.ceil((scrollTop + height) / LINE_HEIGHT) + OVERSCAN);
  const gutter = String(lines.length).length;

  return (
    <div className={styles.raw}>
      <div className={styles.rawBar}>
        <label className={styles.rawSearch}>
          <IconSearch size={13} />
          <input
            ref={inputRef}
            type="search"
            value={query}
            placeholder={t('proxx.requests.raw_search')}
            aria-label={t('proxx.requests.raw_search')}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                step(event.shiftKey ? -1 : 1);
              }
              if (event.key === 'Escape' && query) {
                event.stopPropagation();
                setQuery('');
              }
            }}
          />
          <span className={styles.rawCount} aria-live="polite">
            {debounced
              ? hits.length
                ? `${Math.min(hitIndex, hits.length - 1) + 1}/${hits.length}`
                : '0/0'
              : ''}
          </span>
        </label>
        <button
          type="button"
          className={styles.iconBtn}
          onClick={() => step(-1)}
          disabled={!hits.length}
          aria-label={t('proxx.requests.prev_match')}
          title={t('proxx.requests.prev_match')}
        >
          <IconChevronUp size={14} />
        </button>
        <button
          type="button"
          className={styles.iconBtn}
          onClick={() => step(1)}
          disabled={!hits.length}
          aria-label={t('proxx.requests.next_match')}
          title={t('proxx.requests.next_match')}
        >
          <IconChevronDown size={14} />
        </button>
        <span className={styles.rawMeta}>
          {t('proxx.requests.lines_count', { count: lines.length })}
        </span>
        <button type="button" className={styles.textBtn} onClick={download}>
          <IconDownload size={13} />
          <span>{t('proxx.requests.download')}</span>
        </button>
      </div>
      <div
        ref={scrollRef}
        className={styles.rawScroll}
        onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
        tabIndex={0}
        role="region"
        aria-label={t('proxx.requests.tab.raw')}
      >
        <div style={{ height: lines.length * LINE_HEIGHT, position: 'relative' }}>
          {lines.slice(start, end).map((line, offset) => {
            const index = start + offset;
            return (
              <div
                key={index}
                className={
                  index === activeLine
                    ? `${styles.rawLine} ${styles.rawLineActive}`
                    : styles.rawLine
                }
                style={{ top: index * LINE_HEIGHT, height: LINE_HEIGHT }}
              >
                <span className={styles.rawNo} style={{ width: `${gutter + 1}ch` }}>
                  {index + 1}
                </span>
                <span className={styles.rawText}>
                  {highlight(line, debounced, index === activeLine)}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

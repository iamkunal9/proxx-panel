/** Pure helpers for the Requests page (filters, formatting, cURL export). */

import type { BadgeTone } from '@/components/proxx/ProxxPage';
import { DASH } from '@/components/proxx/format';
import type { HeaderMap, RequestRow, RequestStatusFilter } from '@/types/proxx';

export type TimeRange = '15m' | '1h' | '24h' | '7d' | 'all';

export const TIME_RANGES: readonly TimeRange[] = ['15m', '1h', '24h', '7d', 'all'];
export const STATUS_FILTERS: readonly RequestStatusFilter[] = ['', '2xx', '4xx', '5xx', 'error'];

const RANGE_MS: Record<Exclude<TimeRange, 'all'>, number> = {
  '15m': 15 * 60_000,
  '1h': 60 * 60_000,
  '24h': 24 * 60 * 60_000,
  '7d': 7 * 24 * 60 * 60_000,
};

/** Lower bound (unix ms) for a time range, computed at fetch time. */
export function rangeSince(range: TimeRange, now = Date.now()): number | undefined {
  return range === 'all' ? undefined : now - RANGE_MS[range];
}

export interface RequestFilters {
  status: RequestStatusFilter;
  model: string;
  provider: string;
  q: string;
  range: TimeRange;
}

export const rowTimeMs = (row: RequestRow): number | null => {
  if (row.timeMs !== null) return row.timeMs;
  const parsed = Date.parse(row.time);
  return Number.isNaN(parsed) ? null : parsed;
};

export function statusClass(row: Pick<RequestRow, 'status' | 'error'>): RequestStatusFilter {
  if (row.status === null) return row.error ? 'error' : '';
  if (row.status >= 500) return '5xx';
  if (row.status >= 400) return '4xx';
  if (row.status >= 200 && row.status < 300) return row.error ? 'error' : '2xx';
  return row.error ? 'error' : '';
}

export function statusTone(row: Pick<RequestRow, 'status' | 'error'>): BadgeTone {
  switch (statusClass(row)) {
    case '2xx':
      return 'success';
    case '4xx':
      return 'warning';
    case '5xx':
    case 'error':
      return 'danger';
    default:
      return 'neutral';
  }
}

export const statusTone4 = (status: number | null): BadgeTone =>
  status === null
    ? 'neutral'
    : status >= 500
      ? 'danger'
      : status >= 400
        ? 'warning'
        : status >= 200 && status < 300
          ? 'success'
          : 'neutral';

/**
 * Client-side check of a live row against the active filters. Full-text `q` is server-side only,
 * so callers must not insert live rows while it is set.
 */
export function rowMatchesFilters(
  row: RequestRow,
  filters: RequestFilters,
  now = Date.now()
): boolean {
  if (filters.status) {
    if (filters.status === 'error') {
      if (!row.error && !(row.status !== null && row.status >= 400)) return false;
    } else if (statusClass(row) !== filters.status) return false;
  }
  if (filters.model) {
    const models = [row.requestedModel, row.servedModel, row.group];
    if (!models.includes(filters.model)) return false;
  }
  if (filters.provider && row.provider !== filters.provider) return false;
  const since = rangeSince(filters.range, now);
  if (since !== undefined) {
    const time = rowTimeMs(row);
    if (time !== null && time < since) return false;
  }
  return true;
}

/** Inserts or replaces rows by id, newest first; reconnects and polling may re-deliver rows. */
export function mergeRows(existing: RequestRow[], incoming: RequestRow[]): RequestRow[] {
  if (!incoming.length) return existing;
  const byId = new Map(existing.map((row) => [row.id, row]));
  const fresh: RequestRow[] = [];
  for (const row of incoming) {
    if (byId.has(row.id)) byId.set(row.id, row);
    else fresh.push(row);
  }
  const merged = [...fresh, ...existing.map((row) => byId.get(row.id) ?? row)];
  const seen = new Set<string>();
  return merged
    .filter((row) => (seen.has(row.id) ? false : (seen.add(row.id), true)))
    .sort((a, b) => (rowTimeMs(b) ?? 0) - (rowTimeMs(a) ?? 0));
}

/** "group → served", "requested → served", or a single model name. */
export function modelChain(row: Pick<RequestRow, 'group' | 'requestedModel' | 'servedModel'>): {
  from: string;
  to: string;
} {
  const served = row.servedModel;
  const from = row.group || row.requestedModel;
  if (from && served && from !== served) return { from, to: served };
  return { from: '', to: served || from };
}

export function formatBytes(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value) || value < 0) return DASH;
  if (value < 1024) return `${value} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let size = value / 1024;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit++;
  }
  return `${size.toFixed(size < 10 ? 1 : 0)} ${units[unit]}`;
}

export const formatCount = (value: number | null): string =>
  value === null
    ? DASH
    : value < 10_000
      ? Math.round(value).toLocaleString('en-US')
      : new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(
          value
        );

/** Short relative time ("now", "12s", "5m", "3h", "2d"); absolute time belongs in a tooltip. */
export function formatRelative(ms: number | null, now = Date.now()): string {
  if (ms === null) return DASH;
  const diff = Math.max(0, now - ms);
  if (diff < 5_000) return 'now';
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h`;
  return `${Math.floor(diff / 86_400_000)}d`;
}

export function formatAbsolute(ms: number | null, locale?: string): string {
  if (ms === null) return DASH;
  const date = new Date(ms);
  return Number.isNaN(date.getTime())
    ? DASH
    : date.toLocaleString(locale, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });
}

const SKIPPED_CURL_HEADERS = new Set(['content-length', 'host', 'connection', 'accept-encoding']);

const shellQuote = (value: string) => `'${value.replace(/'/g, `'\\''`)}'`;

/**
 * cURL command for the logged client request. The Authorization (and x-api-key) value is replaced
 * with `$PROXX_KEY` in double quotes so the shell expands it; everything else is single-quoted.
 */
export function buildCurl(input: {
  method: string;
  url: string;
  headers: HeaderMap;
  body: string;
}): string {
  const lines = [`curl -X ${input.method || 'POST'} ${shellQuote(input.url)}`];
  for (const [name, values] of Object.entries(input.headers)) {
    const lower = name.toLowerCase();
    if (SKIPPED_CURL_HEADERS.has(lower)) continue;
    for (const value of values) {
      if (lower === 'authorization') {
        const scheme = /^\s*(\w+)\s+/.exec(value)?.[1];
        lines.push(`-H "${name}: ${scheme ? `${scheme} ` : ''}$PROXX_KEY"`);
      } else if (lower === 'x-api-key' || lower === 'x-goog-api-key') {
        lines.push(`-H "${name}: $PROXX_KEY"`);
      } else {
        lines.push(`-H ${shellQuote(`${name}: ${value}`)}`);
      }
    }
  }
  if (input.body) lines.push(`--data-raw ${shellQuote(input.body)}`);
  return lines.join(' \\\n  ');
}

/** Distinct non-empty values, keeping the currently selected one even if no row has it anymore. */
export function distinctValues(values: string[], selected = ''): string[] {
  const set = new Set(values.filter(Boolean));
  if (selected) set.add(selected);
  return Array.from(set).sort((a, b) => a.localeCompare(b));
}

/** Indices of lines containing `query` (case-insensitive). */
export function searchLines(lines: string[], query: string): number[] {
  const needle = query.toLowerCase();
  if (!needle) return [];
  const hits: number[] = [];
  lines.forEach((line, index) => {
    if (line.toLowerCase().includes(needle)) hits.push(index);
  });
  return hits;
}

/**
 * proxx spend & usage API (`/v8/management/proxx/usage/*`).
 *
 * The backend keeps its own aggregator (per day × model × provider × client API key) and a ring
 * buffer of recent requests. The panel never touches `/observability/usage/queue`, which pops
 * records that other consumers rely on.
 */

import { apiClient } from './client';
import { readBool, readCount, readList, readNullableNumber, readText } from './proxxShared';
import type {
  RecentUsageItem,
  UsageGroupBy,
  UsageRow,
  UsageSummary,
  UsageTotals,
} from '@/types/proxx';
import { isRecord } from '@/utils/helpers';

export type UsageRangePreset = 'today' | '7d' | '30d';

export const USAGE_RANGE_PRESETS: readonly UsageRangePreset[] = ['today', '7d', '30d'];

const PRESET_DAYS: Record<UsageRangePreset, number> = { today: 1, '7d': 7, '30d': 30 };

/** Longest range the daily series is expanded to, as a guard against bad input. */
const MAX_SERIES_DAYS = 400;

const pad = (value: number) => String(value).padStart(2, '0');

/** YYYY-MM-DD from local date parts (toISOString would shift the day outside UTC). */
export function formatLocalDate(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

const parseLocalDate = (value: string): Date | null => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(date.getTime()) ? null : date;
};

export function resolveUsageRange(
  preset: UsageRangePreset,
  now: Date = new Date()
): { from: string; to: string } {
  const to = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const from = new Date(to);
  from.setDate(from.getDate() - (PRESET_DAYS[preset] - 1));
  return { from: formatLocalDate(from), to: formatLocalDate(to) };
}

export const emptyUsageTotals = (): UsageTotals => ({
  requests: 0,
  failures: 0,
  inputTokens: 0,
  outputTokens: 0,
  cachedTokens: 0,
  reasoningTokens: 0,
  costUsd: 0,
  unknownCostRequests: 0,
});

export function normalizeUsageTotals(raw: unknown): UsageTotals {
  if (!isRecord(raw)) return emptyUsageTotals();
  return {
    requests: readCount(raw.requests),
    failures: readCount(raw.failures),
    inputTokens: readCount(raw.input_tokens),
    outputTokens: readCount(raw.output_tokens),
    cachedTokens: readCount(raw.cached_tokens),
    reasoningTokens: readCount(raw.reasoning_tokens),
    costUsd: readCount(raw.cost_usd),
    unknownCostRequests: readCount(raw.unknown_cost_requests),
  };
}

export function normalizeUsageSummary(raw: unknown): UsageSummary {
  const record = isRecord(raw) ? raw : {};
  const rows: UsageRow[] = readList(record.rows)
    .filter(isRecord)
    .map((row) => ({ key: readText(row.key), ...normalizeUsageTotals(row) }));
  return {
    from: readText(record.from),
    to: readText(record.to),
    totals: normalizeUsageTotals(record.totals),
    rows,
  };
}

export function normalizeRecentUsage(raw: unknown): RecentUsageItem[] {
  const items = isRecord(raw) ? readList(raw.items) : readList(raw);
  return items.filter(isRecord).map((item) => {
    const statusCode = readNullableNumber(item.status_code);
    const latencyMs = readNullableNumber(item.latency_ms);
    return {
      timestamp: readText(item.timestamp),
      model: readText(item.model),
      alias: readText(item.alias),
      provider: readText(item.provider),
      apiKey: readText(item.api_key),
      failed: readBool(item.failed),
      statusCode: statusCode && statusCode > 0 ? statusCode : null,
      latencyMs: latencyMs !== null && latencyMs >= 0 ? latencyMs : null,
      stream: readBool(item.stream),
      inputTokens: readCount(item.input_tokens),
      outputTokens: readCount(item.output_tokens),
      cachedTokens: readCount(item.cached_tokens),
      reasoningTokens: readCount(item.reasoning_tokens),
      costUsd: readNullableNumber(item.cost_usd),
      costSource: readText(item.cost_source) || (item.cost_usd == null ? 'unknown' : ''),
    };
  });
}

/** Failure share in percent; 0 when there were no requests (never NaN). */
export function usageFailureRate(totals: Pick<UsageTotals, 'requests' | 'failures'>): number {
  if (!totals.requests) return 0;
  return Math.min(100, (totals.failures / totals.requests) * 100);
}

export const usageTotalTokens = (totals: UsageTotals): number =>
  totals.inputTokens + totals.outputTokens;

/** One row per calendar day in [from, to], zero-filled, so a chart axis stays continuous. */
export function fillDailyUsage(rows: UsageRow[], from: string, to: string): UsageRow[] {
  const start = parseLocalDate(from);
  const end = parseLocalDate(to);
  if (!start || !end || start > end) return rows.slice().sort((a, b) => a.key.localeCompare(b.key));
  const byKey = new Map(rows.map((row) => [row.key, row]));
  const result: UsageRow[] = [];
  const cursor = new Date(start);
  while (cursor <= end && result.length < MAX_SERIES_DAYS) {
    const key = formatLocalDate(cursor);
    result.push(byKey.get(key) ?? { key, ...emptyUsageTotals() });
    cursor.setDate(cursor.getDate() + 1);
  }
  return result;
}

export const proxxUsageApi = {
  async getSummary(params: {
    from: string;
    to: string;
    groupBy: UsageGroupBy;
  }): Promise<UsageSummary> {
    const raw = await apiClient.get<unknown>('/proxx/usage/summary', {
      params: { from: params.from, to: params.to, group_by: params.groupBy },
    });
    return normalizeUsageSummary(raw);
  },

  async getRecent(limit = 50): Promise<RecentUsageItem[]> {
    const raw = await apiClient.get<unknown>('/proxx/usage/recent', { params: { limit } });
    return normalizeRecentUsage(raw);
  },

  reset: () => apiClient.delete('/proxx/usage'),
};

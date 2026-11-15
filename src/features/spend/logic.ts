import type { BadgeTone } from '@/components/proxx/ProxxPage';
import type { UsageRow } from '@/types/proxx';
import { maskApiKey } from '@/utils/format';

/** Client API keys are shown masked unless the backend already masked them. */
export const displayApiKey = (key: string): string =>
  !key ? '' : key.includes('*') || key.length <= 12 ? key : maskApiKey(key);

export const costSourceTone = (source: string): BadgeTone => {
  const value = source.toLowerCase();
  if (!value || value === 'unknown') return 'warning';
  if (value.includes('upstream') || value.includes('header') || value.includes('body')) {
    return 'success';
  }
  if (value.includes('config') || value.includes('override')) return 'accent';
  return 'neutral';
};

export type UsageMetric = 'cost' | 'requests' | 'tokens';

export const metricValue = (row: UsageRow, metric: UsageMetric): number =>
  metric === 'cost'
    ? row.costUsd
    : metric === 'requests'
      ? row.requests
      : row.inputTokens + row.outputTokens;

/** Rounds an axis maximum up to 1/2/2.5/5 × 10^n so tick labels stay readable. */
export function niceAxisMax(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 1;
  const exponent = Math.floor(Math.log10(value));
  const base = 10 ** exponent;
  const fraction = value / base;
  const step = [1, 2, 2.5, 5, 10].find((candidate) => fraction <= candidate) ?? 10;
  return step * base;
}

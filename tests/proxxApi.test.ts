import { describe, expect, test } from 'bun:test';
import {
  fillDailyUsage,
  formatLocalDate,
  normalizeRecentUsage,
  normalizeUsageSummary,
  resolveUsageRange,
  usageFailureRate,
} from '../src/services/api/proxxUsage';
import {
  moveItem,
  normalizeModelGroupsStatus,
  readModelGroupsConfig,
  serializeModelGroupsConfig,
  validateModelGroup,
} from '../src/services/api/proxxGroups';
import {
  normalizePricingCatalog,
  parsePriceInput,
  readPriceOverrides,
  serializePriceOverrides,
} from '../src/services/api/proxxPricing';
import { isProxxUnavailable } from '../src/services/api/proxxShared';

describe('proxx usage normalization', () => {
  test('maps snake_case totals and rows, defaulting bad numbers to 0', () => {
    const summary = normalizeUsageSummary({
      from: '2026-11-10',
      to: '2026-11-16',
      totals: {
        requests: 10,
        failures: 2,
        input_tokens: 1000,
        output_tokens: '500',
        cached_tokens: null,
        reasoning_tokens: -4,
        cost_usd: 1.25,
        unknown_cost_requests: 3,
      },
      rows: [{ key: 'gpt-5', requests: 4, cost_usd: 0.5 }, 'junk', null],
    });
    expect(summary.totals).toEqual({
      requests: 10,
      failures: 2,
      inputTokens: 1000,
      outputTokens: 500,
      cachedTokens: 0,
      reasoningTokens: 0,
      costUsd: 1.25,
      unknownCostRequests: 3,
    });
    expect(summary.rows).toHaveLength(1);
    expect(summary.rows[0].key).toBe('gpt-5');
    expect(summary.rows[0].costUsd).toBe(0.5);
  });

  test('survives a non-object response', () => {
    const summary = normalizeUsageSummary('404 page not found');
    expect(summary.rows).toEqual([]);
    expect(summary.totals.requests).toBe(0);
  });

  test('keeps unknown cost (null) distinct from a free request (0)', () => {
    const items = normalizeRecentUsage({
      items: [
        { model: 'a', cost_usd: null, cost_source: 'unknown', status_code: 200, stream: true },
        { model: 'b:free', cost_usd: 0, cost_source: 'catalog', failed: true, status_code: 429 },
        { model: 'c' },
      ],
    });
    expect(items[0].costUsd).toBeNull();
    expect(items[0].stream).toBe(true);
    expect(items[1].costUsd).toBe(0);
    expect(items[1].failed).toBe(true);
    expect(items[1].statusCode).toBe(429);
    expect(items[2].costUsd).toBeNull();
    expect(items[2].costSource).toBe('unknown');
    expect(items[2].statusCode).toBeNull();
  });

  test('failure rate never divides by zero', () => {
    expect(usageFailureRate({ requests: 0, failures: 0 })).toBe(0);
    expect(usageFailureRate({ requests: 4, failures: 1 })).toBe(25);
  });

  test('date ranges use local calendar days', () => {
    const now = new Date(2026, 10, 16, 23, 59);
    expect(formatLocalDate(now)).toBe('2026-11-16');
    expect(resolveUsageRange('today', now)).toEqual({ from: '2026-11-16', to: '2026-11-16' });
    expect(resolveUsageRange('7d', now)).toEqual({ from: '2026-11-10', to: '2026-11-16' });
    expect(resolveUsageRange('30d', new Date(2026, 2, 1))).toEqual({
      from: '2026-01-31',
      to: '2026-03-01',
    });
  });

  test('daily series is zero-filled and ordered across month boundaries', () => {
    const rows = normalizeUsageSummary({
      rows: [
        { key: '2026-12-01', requests: 2, cost_usd: 0.2 },
        { key: '2026-11-29', requests: 1, cost_usd: 0.1 },
      ],
    }).rows;
    const series = fillDailyUsage(rows, '2026-11-29', '2026-12-02');
    expect(series.map((row) => row.key)).toEqual([
      '2026-11-29',
      '2026-11-30',
      '2026-12-01',
      '2026-12-02',
    ]);
    expect(series.map((row) => row.requests)).toEqual([1, 0, 2, 0]);
  });

  test('404 and 501 mean the proxx backend is missing', () => {
    expect(isProxxUnavailable({ status: 404 })).toBe(true);
    expect(isProxxUnavailable({ status: 501 })).toBe(true);
    expect(isProxxUnavailable({ status: 500 })).toBe(false);
    expect(isProxxUnavailable(new Error('network'))).toBe(false);
  });
});

describe('proxx model groups', () => {
  test('normalizes live status', () => {
    const groups = normalizeModelGroupsStatus({
      groups: [
        {
          name: 'auto',
          strategy: 'round_robin',
          hidden: false,
          members: [
            {
              model: 'gemini-2.5-flash',
              providers: ['gemini', 'gemini', ''],
              available: true,
              cooldown_until: null,
              credentials: 2,
            },
            { model: 'or-kimi', available: false, cooldown_until: '2026-11-16T10:00:00Z' },
            { model: '' },
          ],
        },
        { strategy: 'ordered' },
      ],
    });
    expect(groups).toHaveLength(1);
    expect(groups[0].strategy).toBe('round-robin');
    expect(groups[0].members).toHaveLength(2);
    expect(groups[0].members[0].providers).toEqual(['gemini']);
    expect(groups[0].members[1]).toEqual({
      model: 'or-kimi',
      providers: [],
      available: false,
      cooldownUntil: '2026-11-16T10:00:00Z',
      credentials: 0,
    });
  });

  test('round-trips config and omits defaults', () => {
    const groups = readModelGroupsConfig([
      { name: 'auto', models: ['a', 'b', 'a'] },
      { name: 'fast', strategy: 'round-robin', models: ['c'], hidden: true },
      { models: ['orphan'] },
    ]);
    expect(groups).toEqual([
      { name: 'auto', strategy: 'ordered', models: ['a', 'b'], hidden: false },
      { name: 'fast', strategy: 'round-robin', models: ['c'], hidden: true },
    ]);
    expect(serializeModelGroupsConfig(groups)).toEqual([
      { name: 'auto', models: ['a', 'b'] },
      { name: 'fast', strategy: 'round-robin', models: ['c'], hidden: true },
    ]);
  });

  test('validates names and members', () => {
    const base = { strategy: 'ordered' as const, hidden: false };
    const others = [{ ...base, name: 'auto', models: ['x'] }];
    expect(validateModelGroup({ ...base, name: ' ', models: ['x'] }, [])).toBe('name_required');
    expect(validateModelGroup({ ...base, name: 'my group', models: ['x'] }, [])).toBe(
      'name_invalid'
    );
    expect(validateModelGroup({ ...base, name: 'AUTO', models: ['x'] }, others)).toBe(
      'name_duplicate'
    );
    expect(validateModelGroup({ ...base, name: 'fast', models: [] }, others)).toBe(
      'models_required'
    );
    expect(validateModelGroup({ ...base, name: 'fast', models: ['fast'] }, others)).toBe(
      'self_reference'
    );
    expect(validateModelGroup({ ...base, name: 'fast', models: ['x'] }, others)).toBeNull();
  });

  test('moves members with clamping', () => {
    expect(moveItem(['a', 'b', 'c'], 0, 1)).toEqual(['b', 'a', 'c']);
    expect(moveItem(['a', 'b', 'c'], 2, -1)).toEqual(['a', 'c', 'b']);
    expect(moveItem(['a', 'b', 'c'], 0, -1)).toEqual(['a', 'b', 'c']);
    expect(moveItem(['a', 'b', 'c'], 5, 1)).toEqual(['a', 'b', 'c']);
  });
});

describe('proxx pricing', () => {
  test('normalizes the catalog (underscore keys) without inventing prices', () => {
    const catalog = normalizePricingCatalog({
      catalog_source: 'models.dev',
      updated_at: '2026-11-16T00:00:00Z',
      override_upstream: true,
      models: [
        {
          model: 'gpt-5',
          provider: 'openai',
          input: 1.25,
          output: '10',
          cache_read: 0.125,
          cache_write: null,
          source: 'catalog',
        },
        { provider: 'x' },
      ],
    });
    expect(catalog.overrideUpstream).toBe(true);
    expect(catalog.models).toEqual([
      {
        model: 'gpt-5',
        provider: 'openai',
        input: 1.25,
        output: 10,
        cacheRead: 0.125,
        cacheWrite: null,
        source: 'catalog',
      },
    ]);
  });

  test('reads and writes hyphenated config overrides', () => {
    const overrides = readPriceOverrides([
      { model: 'kimi-k2', 'cache-read': 0.1, input: 0.6, output: 2.5, override: true },
      { model: 'free-model:free', provider: 'openrouter', input: 0, output: 0 },
      { provider: 'missing-model' },
    ]);
    expect(overrides).toHaveLength(2);
    expect(overrides[0].cacheRead).toBe(0.1);
    expect(overrides[0].cacheWrite).toBeNull();
    expect(serializePriceOverrides(overrides)).toEqual([
      { model: 'kimi-k2', input: 0.6, output: 2.5, 'cache-read': 0.1, override: true },
      { model: 'free-model:free', provider: 'openrouter', input: 0, output: 0 },
    ]);
  });

  test('parses price inputs', () => {
    expect(parsePriceInput('')).toBeNull();
    expect(parsePriceInput(' 0 ')).toBe(0);
    expect(parsePriceInput('2.5')).toBe(2.5);
    expect(parsePriceInput('-1')).toBeUndefined();
    expect(parsePriceInput('abc')).toBeUndefined();
  });
});

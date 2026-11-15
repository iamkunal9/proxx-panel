import { describe, expect, test } from 'bun:test';
import {
  costSourceTone,
  displayApiKey,
  metricValue,
  niceAxisMax,
} from '../src/features/spend/logic';
import { buildGroupViews } from '../src/features/modelGroups/logic';
import { filterCatalog, priceSourceTone } from '../src/features/pricing/logic';
import { formatPerMillion, formatUsd } from '../src/components/proxx/format';
import type { CatalogPrice, ModelGroupConfig } from '../src/types/proxx';

describe('spend page logic', () => {
  test('masks raw client keys but keeps already-masked or short ones', () => {
    expect(displayApiKey('')).toBe('');
    expect(displayApiKey('sk-1234567890abcdef')).not.toContain('34567890abcd');
    expect(displayApiKey('sk-ab****cd')).toBe('sk-ab****cd');
    expect(displayApiKey('team-a')).toBe('team-a');
  });

  test('colours cost sources by trust', () => {
    expect(costSourceTone('unknown')).toBe('warning');
    expect(costSourceTone('')).toBe('warning');
    expect(costSourceTone('upstream')).toBe('success');
    expect(costSourceTone('config')).toBe('accent');
    expect(costSourceTone('catalog')).toBe('neutral');
  });

  test('chart axis rounds up to readable steps', () => {
    expect(niceAxisMax(0)).toBe(1);
    expect(niceAxisMax(0.37)).toBeCloseTo(0.5);
    expect(niceAxisMax(1.7)).toBe(2);
    expect(niceAxisMax(2.2)).toBe(2.5);
    expect(niceAxisMax(730)).toBe(1000);
  });

  test('reads the selected metric', () => {
    const row = {
      key: '2026-11-16',
      requests: 3,
      failures: 0,
      inputTokens: 10,
      outputTokens: 5,
      cachedTokens: 0,
      reasoningTokens: 0,
      costUsd: 0.25,
      unknownCostRequests: 0,
    };
    expect(metricValue(row, 'cost')).toBe(0.25);
    expect(metricValue(row, 'requests')).toBe(3);
    expect(metricValue(row, 'tokens')).toBe(15);
  });

  test('formats sub-cent costs without rounding them to zero', () => {
    expect(formatUsd(null)).toBe('—');
    expect(formatUsd(0)).toBe('$0.00');
    expect(formatUsd(0.0042)).toBe('$0.0042');
    expect(formatUsd(12.5)).toBe('$12.50');
    expect(formatPerMillion(null)).toBe('—');
    expect(formatPerMillion(1.25)).toBe('$1.25');
  });
});

describe('model groups page logic', () => {
  const config: ModelGroupConfig[] = [
    { name: 'auto', strategy: 'ordered', models: ['a', 'b'], hidden: false },
  ];

  test('keeps config order and decorates members with live status', () => {
    const views = buildGroupViews(config, [
      {
        name: 'auto',
        strategy: 'ordered',
        hidden: false,
        members: [
          { model: 'b', providers: ['x'], available: true, cooldownUntil: null, credentials: 1 },
        ],
      },
      { name: 'runtime', strategy: 'round-robin', hidden: true, members: [] },
    ]);
    expect(views.map((view) => view.name)).toEqual(['auto', 'runtime']);
    expect(views[0].members.map((member) => member.model)).toEqual(['a', 'b']);
    expect(views[0].members[0].status).toBeNull();
    expect(views[0].members[1].status?.available).toBe(true);
    expect(views[1].config).toBeNull();
  });

  test('works without live status (endpoint missing)', () => {
    const views = buildGroupViews(config, null);
    expect(views).toHaveLength(1);
    expect(views[0].members.every((member) => member.status === null)).toBe(true);
  });
});

describe('pricing page logic', () => {
  const models: CatalogPrice[] = [
    {
      model: 'gpt-5-mini',
      provider: 'openai',
      input: 0.25,
      output: 2,
      cacheRead: null,
      cacheWrite: null,
      source: 'catalog',
    },
    {
      model: 'kimi-k2',
      provider: 'openrouter',
      input: 0.6,
      output: 2.5,
      cacheRead: null,
      cacheWrite: null,
      source: 'config',
    },
  ];

  test('search matches every term across model and provider', () => {
    expect(filterCatalog(models, '')).toHaveLength(2);
    expect(filterCatalog(models, 'KIMI')).toHaveLength(1);
    expect(filterCatalog(models, 'openai mini')).toHaveLength(1);
    expect(filterCatalog(models, 'openai kimi')).toHaveLength(0);
  });

  test('source badge tones', () => {
    expect(priceSourceTone('config')).toBe('accent');
    expect(priceSourceTone('catalog')).toBe('neutral');
    expect(priceSourceTone('')).toBe('warning');
  });
});

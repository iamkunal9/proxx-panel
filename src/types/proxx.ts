/**
 * proxx fork features (spend & usage, model groups, pricing).
 * Backend contracts: docs/proxx.md and ../proxx/docs/proxx/decisions/.
 */

/* Usage --------------------------------------------------------------------------------------- */

export type UsageGroupBy = 'model' | 'provider' | 'api_key' | 'day';

export interface UsageTotals {
  requests: number;
  failures: number;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  reasoningTokens: number;
  /** Sum of known costs in USD; requests with unknown cost are counted separately. */
  costUsd: number;
  unknownCostRequests: number;
}

export interface UsageRow extends UsageTotals {
  key: string;
}

export interface UsageSummary {
  from: string;
  to: string;
  totals: UsageTotals;
  rows: UsageRow[];
}

export interface RecentUsageItem {
  timestamp: string;
  model: string;
  alias: string;
  provider: string;
  apiKey: string;
  failed: boolean;
  statusCode: number | null;
  latencyMs: number | null;
  stream: boolean;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  reasoningTokens: number;
  /** null means the cost is unknown, which is different from a free (0) request. */
  costUsd: number | null;
  costSource: string;
}

/* Model groups -------------------------------------------------------------------------------- */

export type ModelGroupStrategy = 'ordered' | 'round-robin';

export interface ModelGroupMemberStatus {
  model: string;
  providers: string[];
  available: boolean;
  cooldownUntil: string | null;
  credentials: number;
}

export interface ModelGroupStatus {
  name: string;
  strategy: ModelGroupStrategy;
  hidden: boolean;
  members: ModelGroupMemberStatus[];
}

/** One entry of `proxx.model-groups` in the config. */
export interface ModelGroupConfig {
  name: string;
  strategy: ModelGroupStrategy;
  models: string[];
  hidden: boolean;
}

/* Pricing ------------------------------------------------------------------------------------- */

export interface CatalogPrice {
  model: string;
  provider: string;
  input: number | null;
  output: number | null;
  cacheRead: number | null;
  cacheWrite: number | null;
  source: string;
}

export interface PricingCatalog {
  catalogSource: string;
  updatedAt: string;
  overrideUpstream: boolean;
  models: CatalogPrice[];
}

/** One entry of `proxx.pricing.models` in the config (USD per 1M tokens). */
export interface PriceOverride {
  model: string;
  provider: string;
  input: number | null;
  output: number | null;
  cacheRead: number | null;
  cacheWrite: number | null;
  reasoning: number | null;
  override: boolean;
}

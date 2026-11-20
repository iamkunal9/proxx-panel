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

/* Requests (request-log browser) -------------------------------------------------------------- */

export type RequestStatusFilter = '' | '2xx' | '4xx' | '5xx' | 'error';

/** One logged request. Unknown numbers are null and render as a dash. */
export interface RequestRow {
  id: string;
  file: string;
  time: string;
  timeMs: number | null;
  method: string;
  path: string;
  /** HTTP status; null when the backend did not record one. */
  status: number | null;
  durationMs: number | null;
  stream: boolean;
  requestedModel: string;
  servedModel: string;
  group: string;
  provider: string;
  inputTokens: number | null;
  outputTokens: number | null;
  reasoningTokens: number | null;
  cachedTokens: number | null;
  costUsd: number | null;
  costSource: string;
  attempts: number;
  error: boolean;
  sizeBytes: number | null;
}

export interface RequestListPage {
  items: RequestRow[];
  nextCursor: string;
  requestLogEnabled: boolean;
  totalSizeBytes: number | null;
  /** 0 means unlimited. */
  maxTotalSizeBytes: number;
  logDir: string;
}

export interface RequestListQuery {
  limit?: number;
  cursor?: string;
  status?: RequestStatusFilter;
  model?: string;
  provider?: string;
  q?: string;
  since?: number;
  until?: number;
}

export type HeaderMap = Record<string, string[]>;

export interface RequestClientSection {
  url: string;
  method: string;
  headers: HeaderMap;
  body: string;
  bodyTruncated: boolean;
}

export interface RequestAttempt {
  index: number;
  url: string;
  method: string;
  headers: HeaderMap;
  body: string;
  bodyTruncated: boolean;
  status: number | null;
  responseHeaders: HeaderMap;
  responseBody: string;
  responseTruncated: boolean;
  error: string;
  timestamp: string;
}

export interface SseEvent {
  event: string;
  data: string;
}

export interface AssembledToolCall {
  id: string;
  name: string;
  arguments: string;
}

export interface AssembledResponse {
  text: string;
  reasoning: string;
  toolCalls: AssembledToolCall[];
}

export interface RequestResponseSection {
  status: number | null;
  /** Local read/dial/stream diagnostics the logger wrote into the final response (backend v8.0.79+). */
  errors: string[];
  headers: HeaderMap;
  body: string;
  bodyTruncated: boolean;
  sseEvents: SseEvent[] | null;
  assembled: AssembledResponse | null;
}

export interface RequestDetail {
  row: RequestRow;
  client: RequestClientSection;
  attempts: RequestAttempt[];
  response: RequestResponseSection;
  websocketTimeline: string;
  apiWebsocketTimeline: string;
  rawSizeBytes: number | null;
}

// ---- Self-update (`/proxx/update`) ----

export type UpdateState =
  | 'idle'
  | 'checking'
  | 'downloading'
  | 'verifying'
  | 'staged'
  | 'waiting_idle'
  | 'applying'
  | 'failed';

export interface UpdateConfig {
  check: boolean;
  intervalHours: number;
  autoApply: boolean;
  /** "HH:MM-HH:MM" in the backend's local time; empty = any time. */
  window: string;
}

export interface UpdateResult {
  from: string;
  to: string;
  at: string;
  ok: boolean;
  rolledBack: boolean;
  error: string;
}

export interface UpdateStatus {
  /** 0 when the backend does not report a level. */
  apiLevel: number;
  currentVersion: string;
  latestVersion: string;
  updateAvailable: boolean;
  releaseUrl: string;
  releaseNotes: string;
  checkedAt: string;
  lastCheckError: string;
  supported: boolean;
  unsupportedReason: string;
  state: UpdateState;
  inflight: number;
  stagedVersion: string;
  config: UpdateConfig;
  lastResult: UpdateResult | null;
}

/**
 * proxx request-log browser API (`/v8/management/proxx/requests*`).
 *
 * The backend parses the request-log files written when `observability.logs.request-log` is on.
 * Unknown numbers stay null so the UI renders a dash instead of inventing zeros.
 */

import { apiClient } from './client';
import { readBool, readCount, readList, readNullableNumber, readText } from './proxxShared';
import type {
  AssembledResponse,
  HeaderMap,
  RequestAttempt,
  RequestDetail,
  RequestListPage,
  RequestListQuery,
  RequestRow,
  SseEvent,
} from '@/types/proxx';
import { isRecord } from '@/utils/helpers';

export const REQUESTS_PAGE_SIZE = 50;

/** Body text as-is (never trimmed: whitespace can be part of a prompt). */
const readBody = (value: unknown): string =>
  typeof value === 'string' ? value : value == null ? '' : JSON.stringify(value);

const readStatus = (value: unknown): number | null => {
  const status = readNullableNumber(value);
  return status !== null && status > 0 ? status : null;
};

const readNonNegative = (value: unknown): number | null => {
  const number = readNullableNumber(value);
  return number !== null && number >= 0 ? number : null;
};

export function normalizeHeaders(raw: unknown): HeaderMap {
  if (!isRecord(raw)) return {};
  const result: HeaderMap = {};
  for (const [key, value] of Object.entries(raw)) {
    if (Array.isArray(value)) result[key] = value.map((entry) => String(entry ?? ''));
    else if (value !== null && value !== undefined) result[key] = [String(value)];
  }
  return result;
}

export function normalizeRequestRow(raw: unknown): RequestRow {
  const row = isRecord(raw) ? raw : {};
  const attempts = readNullableNumber(row.attempts);
  return {
    id: readText(row.id),
    file: readText(row.file),
    time: readText(row.time),
    timeMs: readNonNegative(row.time_ms),
    method: readText(row.method).toUpperCase(),
    path: readText(row.path),
    status: readStatus(row.status),
    durationMs: readNonNegative(row.duration_ms),
    stream: readBool(row.stream),
    requestedModel: readText(row.requested_model),
    servedModel: readText(row.served_model),
    group: readText(row.group),
    provider: readText(row.provider),
    inputTokens: readNonNegative(row.input_tokens),
    outputTokens: readNonNegative(row.output_tokens),
    reasoningTokens: readNonNegative(row.reasoning_tokens),
    cachedTokens: readNonNegative(row.cached_tokens),
    costUsd: readNullableNumber(row.cost_usd),
    costSource: readText(row.cost_source),
    attempts: attempts !== null && attempts > 0 ? Math.round(attempts) : 0,
    error: readBool(row.error),
    sizeBytes: readNonNegative(row.size_bytes),
  };
}

const readStringList = (value: unknown): string[] => readList(value).map(readText).filter(Boolean);

export function normalizeRequestList(raw: unknown): RequestListPage {
  const record = isRecord(raw) ? raw : {};
  return {
    items: readList(record.items)
      .filter(isRecord)
      .map(normalizeRequestRow)
      .filter((row) => row.id),
    nextCursor: readText(record.next_cursor),
    models: readStringList(record.models),
    providers: readStringList(record.providers),
    requestLogEnabled: readBool(record.request_log_enabled),
    totalSizeBytes: readNonNegative(record.total_size_bytes),
    maxTotalSizeBytes: readCount(record.max_total_size_bytes),
    logDir: readText(record.log_dir),
  };
}

function normalizeSseEvents(raw: unknown): SseEvent[] | null {
  if (!Array.isArray(raw)) return null;
  return raw
    .filter(isRecord)
    .map((event) => ({ event: readText(event.event), data: readBody(event.data) }));
}

function normalizeAssembled(raw: unknown): AssembledResponse | null {
  if (!isRecord(raw)) return null;
  return {
    text: readBody(raw.text),
    reasoning: readBody(raw.reasoning),
    toolCalls: readList(raw.tool_calls)
      .filter(isRecord)
      .map((call) => ({
        id: readText(call.id),
        name: readText(call.name),
        arguments: readBody(call.arguments),
      })),
  };
}

function normalizeAttempt(raw: unknown, position: number): RequestAttempt {
  const attempt = isRecord(raw) ? raw : {};
  const index = readNullableNumber(attempt.index);
  return {
    index: index !== null && index > 0 ? index : position + 1,
    url: readText(attempt.url),
    method: readText(attempt.method).toUpperCase(),
    headers: normalizeHeaders(attempt.headers),
    body: readBody(attempt.body),
    bodyTruncated: readBool(attempt.body_truncated),
    status: readStatus(attempt.status),
    responseHeaders: normalizeHeaders(attempt.response_headers),
    responseBody: readBody(attempt.response_body),
    responseTruncated: readBool(attempt.response_truncated),
    error: readBody(attempt.error),
    timestamp: readText(attempt.timestamp),
  };
}

export function normalizeRequestDetail(raw: unknown): RequestDetail {
  const record = isRecord(raw) ? raw : {};
  const client = isRecord(record.client) ? record.client : {};
  const response = isRecord(record.response) ? record.response : {};
  return {
    row: normalizeRequestRow(record.row),
    client: {
      url: readText(client.url),
      method: readText(client.method).toUpperCase(),
      headers: normalizeHeaders(client.headers),
      body: readBody(client.body),
      bodyTruncated: readBool(client.body_truncated),
    },
    attempts: readList(record.attempts).map(normalizeAttempt),
    response: {
      status: readStatus(response.status),
      errors: readList(response.errors).filter(
        (value): value is string => typeof value === 'string' && value !== ''
      ),
      headers: normalizeHeaders(response.headers),
      body: readBody(response.body),
      bodyTruncated: readBool(response.body_truncated),
      sseEvents: normalizeSseEvents(response.sse_events),
      assembled: normalizeAssembled(response.assembled),
    },
    websocketTimeline: readBody(record.websocket_timeline),
    apiWebsocketTimeline: readBody(record.api_websocket_timeline),
    rawSizeBytes: readNonNegative(record.raw_size_bytes),
  };
}

/** Query params without empty values (axios would send `q=` for an empty string). */
export function buildRequestListParams(query: RequestListQuery): Record<string, string | number> {
  const params: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    params[key] = value as string | number;
  }
  return params;
}

const encodeId = (id: string) => encodeURIComponent(id);

export const proxxRequestsApi = {
  async list(query: RequestListQuery = {}): Promise<RequestListPage> {
    const raw = await apiClient.get<unknown>('/proxx/requests', {
      params: buildRequestListParams({ limit: REQUESTS_PAGE_SIZE, ...query }),
    });
    return normalizeRequestList(raw);
  },

  async get(id: string): Promise<RequestDetail> {
    const raw = await apiClient.get<unknown>(`/proxx/requests/${encodeId(id)}`);
    return normalizeRequestDetail(raw);
  },

  async raw(id: string): Promise<string> {
    const raw = await apiClient.get<unknown>(`/proxx/requests/${encodeId(id)}/raw`, {
      responseType: 'text',
      transformResponse: [(data: unknown) => data],
    });
    return typeof raw === 'string' ? raw : readBody(raw);
  },

  remove: (id: string) => apiClient.delete(`/proxx/requests/${encodeId(id)}`),

  async clear(): Promise<number> {
    const raw = await apiClient.delete<unknown>('/proxx/requests');
    return isRecord(raw) ? readCount(raw.removed) : 0;
  },
};

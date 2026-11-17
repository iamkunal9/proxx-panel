/**
 * proxx binary self-update API (`/v8/management/proxx/update*`).
 *
 * `GET /proxx/update` answers 404 on proxx builds that predate in-panel updates; callers treat
 * that as "backend too old" and point at the install script instead.
 */

import { apiClient } from './client';
import { guardConfigConnection } from './configValue';
import { readBool, readCount, readText } from './proxxShared';
import type { UpdateConfig, UpdateResult, UpdateState, UpdateStatus } from '@/types/proxx';
import { isRecord } from '@/utils/helpers';

/** The lowest backend `api_level` this panel understands. Also stamped into release notes. */
export const MIN_BACKEND_API = 1;

export const INSTALL_COMMAND =
  'curl -fsSL https://raw.githubusercontent.com/iamkunal9/proxx/main/install.sh | sh';

export const UPDATE_PATH = '/proxx/update';

export type UpdateConfigKey = 'check' | 'interval-hours' | 'auto-apply' | 'window';

export const updateConfigPath = (key: UpdateConfigKey): string => `/config/proxx/update/${key}`;

const UPDATE_STATES: readonly UpdateState[] = [
  'idle',
  'checking',
  'downloading',
  'verifying',
  'staged',
  'waiting_idle',
  'applying',
  'failed',
];

const readState = (value: unknown): UpdateState => {
  const text = readText(value).toLowerCase() as UpdateState;
  return UPDATE_STATES.includes(text) ? text : 'idle';
};

export function normalizeUpdateConfig(raw: unknown): UpdateConfig {
  const record = isRecord(raw) ? raw : {};
  const interval = readCount(record.interval_hours ?? record['interval-hours']);
  return {
    check: readBool(record.check),
    intervalHours: interval > 0 ? Math.round(interval) : 0,
    autoApply: readBool(record.auto_apply ?? record['auto-apply']),
    window: readText(record.window),
  };
}

export function normalizeUpdateResult(raw: unknown): UpdateResult | null {
  if (!isRecord(raw)) return null;
  return {
    from: readText(raw.from),
    to: readText(raw.to),
    at: readText(raw.at),
    ok: readBool(raw.ok),
    rolledBack: readBool(raw.rolled_back),
    error: readText(raw.error),
  };
}

export function normalizeUpdateStatus(raw: unknown): UpdateStatus {
  const record = isRecord(raw) ? raw : {};
  return {
    apiLevel: Math.floor(readCount(record.api_level)),
    currentVersion: readText(record.current_version),
    latestVersion: readText(record.latest_version),
    updateAvailable: readBool(record.update_available),
    releaseUrl: readText(record.release_url),
    releaseNotes: typeof record.release_notes === 'string' ? record.release_notes : '',
    checkedAt: readText(record.checked_at),
    lastCheckError: readText(record.last_check_error),
    // Absent means an older contract; only an explicit false disables updating.
    supported: record.supported === undefined ? true : readBool(record.supported),
    unsupportedReason: readText(record.unsupported_reason),
    state: readState(record.state),
    inflight: Math.floor(readCount(record.inflight)),
    stagedVersion: readText(record.staged_version),
    config: normalizeUpdateConfig(record.config),
    lastResult: normalizeUpdateResult(record.last_result),
  };
}

/** True when the update route itself is missing: the backend predates in-panel updates. */
export const isUpdateRouteMissing = (error: unknown): boolean =>
  isRecord(error) && error.status === 404;

/** Network-level failure (no HTTP response), e.g. while proxx restarts. */
export const isConnectionFailure = (error: unknown): boolean =>
  isRecord(error) &&
  (error.status === undefined ||
    error.status === 0 ||
    error.status === 502 ||
    error.status === 503);

/**
 * Body for `PUT /config/proxx/update/<key>`.
 *
 * The v8 config endpoint (`/config/*path`) stores the JSON body verbatim at that path, the same
 * way the pricing and request-log toggles are written, so the value is sent unwrapped.
 */
export const serializeUpdateConfigValue = (value: boolean | number | string): unknown => value;

export const proxxUpdateApi = {
  async getStatus(): Promise<UpdateStatus> {
    return normalizeUpdateStatus(await apiClient.get<unknown>(UPDATE_PATH));
  },

  async check(): Promise<UpdateStatus> {
    return normalizeUpdateStatus(await apiClient.post<unknown>(`${UPDATE_PATH}/check`));
  },

  /** 202 with the status; a 409 rejects with the backend's `{error}` message. */
  async apply(): Promise<UpdateStatus> {
    return normalizeUpdateStatus(await apiClient.post<unknown>(`${UPDATE_PATH}/apply`));
  },

  async cancel(): Promise<UpdateStatus | null> {
    const raw = await apiClient.post<unknown>(`${UPDATE_PATH}/cancel`);
    return isRecord(raw) && 'state' in raw ? normalizeUpdateStatus(raw) : null;
  },

  async setConfig(
    key: UpdateConfigKey,
    value: boolean | number | string,
    assertSameConnection: () => void = guardConfigConnection()
  ): Promise<void> {
    assertSameConnection();
    await apiClient.put(updateConfigPath(key), serializeUpdateConfigValue(value));
  },
};

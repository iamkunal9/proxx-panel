/**
 * Pure logic for the self-update page: polling cadence, the stepper model, settings validation
 * and the post-apply reconnect state machine. Time is always passed in, so tests never sleep.
 */

import type { UpdateConfig, UpdateResult, UpdateState, UpdateStatus } from '@/types/proxx';
import type { UpdateConfigKey } from '@/services/api/proxxUpdate';

export const POLL_IDLE_MS = 5 * 60 * 1000;
export const POLL_ACTIVE_MS = 2000;
/** How long the backend may stay unreachable after an apply before we give up. */
export const RECONNECT_TIMEOUT_MS = 60 * 1000;
/** How long the backend may report the old version (with no new result) after restarting. */
export const STALE_VERSION_GRACE_MS = 15 * 1000;
/** Before a restart, an apply that settles back to idle/staged this long is treated as cancelled. */
export const CANCEL_GRACE_MS = 10 * 1000;

export const IN_PROGRESS_STATES: readonly UpdateState[] = [
  'checking',
  'downloading',
  'verifying',
  'waiting_idle',
  'applying',
];

export const isInProgress = (state: UpdateState | undefined): boolean =>
  state !== undefined && IN_PROGRESS_STATES.includes(state);

export const normalizeVersion = (version: string): string =>
  version.trim().replace(/^v/i, '').toLowerCase();

export const displayVersion = (version: string): string => {
  const trimmed = version.trim();
  if (!trimmed) return '—';
  return /^\d/.test(trimmed) ? `v${trimmed}` : trimmed;
};

// ---- Reconnect state machine ----

export type ApplyPhase =
  'idle' | 'pending' | 'restarting' | 'success' | 'rolled_back' | 'failed' | 'timeout';

export interface ApplyTracking {
  phase: ApplyPhase;
  fromVersion: string;
  targetVersion: string;
  /** Identity of `last_result` before the apply, so only a new result counts. */
  baselineResult: string;
  startedAt: number;
  /** First failed fetch of the current outage, or null while reachable. */
  failingSince: number | null;
  sawRestart: boolean;
  /** When the restarted backend was first seen idle on the old version. */
  backOnOldSince: number | null;
  lastState: UpdateState;
  inflight: number;
  error: string;
  result: UpdateResult | null;
}

export const IDLE_TRACKING: ApplyTracking = {
  phase: 'idle',
  fromVersion: '',
  targetVersion: '',
  baselineResult: '',
  startedAt: 0,
  failingSince: null,
  sawRestart: false,
  backOnOldSince: null,
  lastState: 'idle',
  inflight: 0,
  error: '',
  result: null,
};

export const isTracking = (tracking: ApplyTracking): boolean =>
  tracking.phase === 'pending' || tracking.phase === 'restarting';

export const isTerminal = (tracking: ApplyTracking): boolean =>
  tracking.phase === 'success' ||
  tracking.phase === 'rolled_back' ||
  tracking.phase === 'failed' ||
  tracking.phase === 'timeout';

export const resultKey = (result: UpdateResult | null): string =>
  result
    ? [result.from, result.to, result.at, result.ok, result.rolledBack, result.error].join('|')
    : '';

export type ApplyEvent =
  | { type: 'started'; status: UpdateStatus; now: number }
  | { type: 'status'; status: UpdateStatus; now: number }
  | { type: 'fetch_failed'; now: number }
  | { type: 'dismiss' };

/** Starts tracking an apply (user-triggered, or an auto-apply noticed by the poller). */
export function startTracking(status: UpdateStatus, now: number): ApplyTracking {
  return {
    ...IDLE_TRACKING,
    phase: 'pending',
    fromVersion: status.currentVersion,
    targetVersion: status.stagedVersion || status.latestVersion,
    baselineResult: resultKey(status.lastResult),
    startedAt: now,
    lastState: status.state,
    inflight: status.inflight,
  };
}

export function reduceApply(tracking: ApplyTracking, event: ApplyEvent): ApplyTracking {
  if (event.type === 'dismiss') return IDLE_TRACKING;

  if (event.type === 'started') {
    // The apply response is the first status of the new tracking.
    return reduceApply(startTracking(event.status, event.now), {
      type: 'status',
      status: event.status,
      now: event.now,
    });
  }

  if (event.type === 'fetch_failed') {
    if (!isTracking(tracking)) return tracking;
    const failingSince = tracking.failingSince ?? event.now;
    if (event.now - failingSince >= RECONNECT_TIMEOUT_MS) {
      return { ...tracking, phase: 'timeout', failingSince, sawRestart: true };
    }
    return { ...tracking, phase: 'restarting', failingSince, sawRestart: true };
  }

  const { status, now } = event;

  if (!isTracking(tracking)) {
    // A backend-driven apply (auto-apply in the maintenance window) starts tracking on its own.
    if (status.state === 'waiting_idle' || status.state === 'applying') {
      if (tracking.phase === 'idle' || isTerminal(tracking)) return startTracking(status, now);
    }
    return tracking;
  }

  const next: ApplyTracking = {
    ...tracking,
    phase: 'pending',
    failingSince: null,
    lastState: status.state,
    inflight: status.inflight,
  };
  const current = normalizeVersion(status.currentVersion);
  const from = normalizeVersion(tracking.fromVersion);
  const target = normalizeVersion(tracking.targetVersion);
  const result = status.lastResult;
  const newResult = result !== null && resultKey(result) !== tracking.baselineResult;

  if (newResult && (result.rolledBack || !result.ok)) {
    return {
      ...next,
      phase: result.rolledBack ? 'rolled_back' : 'failed',
      error: result.error,
      result,
    };
  }
  if (current && ((target && current === target) || (from && current !== from))) {
    return { ...next, phase: 'success', result: newResult ? result : next.result };
  }
  if (newResult && result.ok) {
    return { ...next, phase: 'success', result };
  }
  if (status.state === 'failed') {
    return {
      ...next,
      phase: 'failed',
      error: result?.error || status.lastCheckError,
      result: newResult ? result : null,
    };
  }

  const settled = status.state === 'idle' || status.state === 'staged';
  if (settled && !tracking.sawRestart) {
    // Cancelled (here or elsewhere) before the restart: stop tracking quietly.
    return now - tracking.startedAt >= CANCEL_GRACE_MS ? IDLE_TRACKING : next;
  }
  if (settled && tracking.sawRestart) {
    const backOnOldSince = tracking.backOnOldSince ?? now;
    if (now - backOnOldSince >= STALE_VERSION_GRACE_MS) {
      return { ...next, phase: 'failed', backOnOldSince, error: '' };
    }
    return { ...next, backOnOldSince };
  }
  return { ...next, backOnOldSince: null };
}

// ---- Stepper ----

export type StepId = 'downloading' | 'verifying' | 'staged' | 'waiting_idle' | 'applying' | 'done';
export type StepStatus = 'done' | 'active' | 'pending' | 'error';

export const STEPS: readonly StepId[] = [
  'downloading',
  'verifying',
  'staged',
  'waiting_idle',
  'applying',
  'done',
];

const stepIndex = (state: UpdateState): number => {
  const index = STEPS.indexOf(state as StepId);
  return index === -1 ? -1 : index;
};

export function showStepper(state: UpdateState | undefined, tracking: ApplyTracking): boolean {
  if (tracking.phase !== 'idle') return true;
  return state !== undefined && stepIndex(state) !== -1;
}

export function stepperModel(
  state: UpdateState | undefined,
  tracking: ApplyTracking
): Array<{ id: StepId; status: StepStatus }> {
  let active: number;
  let failed = false;
  if (tracking.phase === 'success') {
    active = STEPS.length;
  } else if (tracking.phase === 'restarting') {
    active = STEPS.indexOf('applying');
  } else if (
    tracking.phase === 'rolled_back' ||
    tracking.phase === 'failed' ||
    tracking.phase === 'timeout'
  ) {
    failed = true;
    const last = stepIndex(tracking.lastState);
    active = tracking.sawRestart || last === -1 ? STEPS.indexOf('applying') : last;
  } else {
    const current = state ?? tracking.lastState;
    active = stepIndex(current);
    if (active === -1) active = tracking.phase === 'pending' ? 0 : -1;
  }
  return STEPS.map((id, index) => ({
    id,
    status: index < active ? 'done' : index === active ? (failed ? 'error' : 'active') : 'pending',
  }));
}

export function nextPollDelay(status: UpdateStatus | null, tracking: ApplyTracking): number {
  return isTracking(tracking) || isInProgress(status?.state) ? POLL_ACTIVE_MS : POLL_IDLE_MS;
}

// ---- Settings ----

const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;

export interface WindowDraft {
  anyTime: boolean;
  start: string;
  end: string;
}

export function parseWindow(window: string): WindowDraft {
  const match = /^\s*(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})\s*$/.exec(window);
  if (!match) return { anyTime: true, start: '', end: '' };
  const pad = (value: string) => value.padStart(5, '0');
  return { anyTime: false, start: pad(match[1]), end: pad(match[2]) };
}

export type WindowError = '' | 'window_incomplete' | 'window_invalid' | 'window_same';

/** Overnight windows (start later than end, e.g. 22:00-04:00) are valid. */
export function validateWindow(draft: WindowDraft): WindowError {
  if (draft.anyTime) return '';
  const start = draft.start.trim();
  const end = draft.end.trim();
  if (!start || !end) return 'window_incomplete';
  if (!TIME.test(start) || !TIME.test(end)) return 'window_invalid';
  if (start === end) return 'window_same';
  return '';
}

export const formatWindow = (draft: WindowDraft): string =>
  draft.anyTime ? '' : `${draft.start.trim()}-${draft.end.trim()}`;

export const INTERVAL_MIN_HOURS = 1;
export const INTERVAL_MAX_HOURS = 720;

/** Whole hours in range, or undefined when invalid. */
export function parseIntervalHours(text: string): number | undefined {
  const trimmed = text.trim();
  if (!/^\d+$/.test(trimmed)) return undefined;
  const hours = Number(trimmed);
  return hours >= INTERVAL_MIN_HOURS && hours <= INTERVAL_MAX_HOURS ? hours : undefined;
}

/** The config writes needed to turn `original` into `draft`, in a stable order. */
export function diffUpdateConfig(
  original: UpdateConfig,
  draft: UpdateConfig
): Array<{ key: UpdateConfigKey; value: boolean | number | string }> {
  const changes: Array<{ key: UpdateConfigKey; value: boolean | number | string }> = [];
  if (draft.check !== original.check) changes.push({ key: 'check', value: draft.check });
  if (draft.intervalHours !== original.intervalHours) {
    changes.push({ key: 'interval-hours', value: draft.intervalHours });
  }
  if (draft.autoApply !== original.autoApply) {
    changes.push({ key: 'auto-apply', value: draft.autoApply });
  }
  if (draft.window.trim() !== original.window.trim()) {
    changes.push({ key: 'window', value: draft.window.trim() });
  }
  return changes;
}

export interface UpdateSettingsDraft {
  check: boolean;
  interval: string;
  autoApply: boolean;
  window: WindowDraft;
}

export const draftFromConfig = (config: UpdateConfig): UpdateSettingsDraft => ({
  check: config.check,
  interval: config.intervalHours > 0 ? String(config.intervalHours) : '24',
  autoApply: config.autoApply,
  window: parseWindow(config.window),
});

export interface SettingsValidation {
  intervalError: string;
  windowError: string;
  config: UpdateConfig | null;
}

/** Validates the draft; `config` is the value to save, or null when invalid. */
export function validateSettingsDraft(draft: UpdateSettingsDraft): SettingsValidation {
  const hours = parseIntervalHours(draft.interval);
  const windowError = validateWindow(draft.window);
  const intervalError = hours === undefined ? 'interval_invalid' : '';
  return {
    intervalError,
    windowError,
    config:
      hours !== undefined && !windowError
        ? {
            check: draft.check,
            intervalHours: hours,
            autoApply: draft.autoApply,
            window: formatWindow(draft.window),
          }
        : null,
  };
}

// ---- View helpers ----

export function formatTimestamp(value: string): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

export const canApplyUpdate = (status: UpdateStatus | null, tracking: ApplyTracking): boolean =>
  Boolean(
    status &&
    status.supported &&
    (status.updateAvailable || status.stagedVersion) &&
    !isInProgress(status.state) &&
    !isTracking(tracking)
  );

/** Only http(s) links leave the panel; anything else (javascript:, data:, …) is dropped. */
export const safeHref = (url: string): string =>
  /^https?:\/\//i.test(url.trim()) ? url.trim() : '';

/**
 * Removes HTML comments (release tooling markers such as
 * `<!-- cliproxyapi-linux-release-assets:start -->`). An unterminated comment, as left by a
 * truncated body, is cut to the end. Other raw HTML stays and is rendered as text.
 */
export const stripHtmlComments = (text: string): string =>
  text
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<!--[\s\S]*$/, '')
    .replace(/\n{3,}/g, '\n\n');

const PRERELEASE_WORDS = /^(alpha|beta|rc|pre|preview|dev|snapshot|nightly)$/i;

const versionTokens = (version: string): Array<number | string> =>
  (normalizeVersion(version).match(/\d+|[a-z]+/g) ?? []).map((token) =>
    /^\d+$/.test(token) ? Number(token) : token
  );

/**
 * Orders proxx versions such as `v8.0.73-proxx.4-rc.1` (> 0 when a is newer). Number and word
 * runs compare in order. When one version is a prefix of the other, a trailing prerelease word
 * (rc, beta, …) makes the longer one older; any other suffix (`-proxx.3`) makes it newer.
 */
export function compareVersions(a: string, b: string): number {
  const left = versionTokens(a);
  const right = versionTokens(b);
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const x = left[index];
    const y = right[index];
    if (x === undefined || y === undefined) {
      const rest = (x ?? y) as number | string;
      const longerIsOlder = typeof rest === 'string' && PRERELEASE_WORDS.test(rest);
      const sign = x === undefined ? -1 : 1;
      return longerIsOlder ? -sign : sign;
    }
    if (x === y) continue;
    if (typeof x === 'number' && typeof y === 'number') return x - y;
    if (typeof x === 'number') return 1;
    if (typeof y === 'number') return -1;
    // Two words: a prerelease word sorts before any other word.
    const px = PRERELEASE_WORDS.test(x);
    const py = PRERELEASE_WORDS.test(y);
    if (px !== py) return px ? -1 : 1;
    return x < y ? -1 : 1;
  }
  return 0;
}

/** The running build is newer than the latest release, so there is nothing to install. */
export const runningNewerBuild = (status: UpdateStatus): boolean =>
  !status.updateAvailable &&
  Boolean(status.currentVersion && status.latestVersion) &&
  compareVersions(status.currentVersion, status.latestVersion) > 0;

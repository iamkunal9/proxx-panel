import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  spyOn,
  test,
} from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import i18n from '@/i18n';
import { apiClient } from '@/services/api/client';
import {
  INSTALL_COMMAND,
  MIN_BACKEND_API,
  isUpdateRouteMissing,
  normalizeUpdateStatus,
  proxxUpdateApi,
  updateConfigPath,
} from '@/services/api/proxxUpdate';
import type { UpdateState, UpdateStatus } from '@/types/proxx';
import { UpdateSettings } from '@/features/update/components/UpdateSettings';
import { UpdateView, type UpdateViewProps } from '@/features/update/components/UpdateView';
import {
  IDLE_TRACKING,
  POLL_ACTIVE_MS,
  POLL_IDLE_MS,
  RECONNECT_TIMEOUT_MS,
  STALE_VERSION_GRACE_MS,
  canApplyUpdate,
  diffUpdateConfig,
  formatWindow,
  nextPollDelay,
  parseIntervalHours,
  parseWindow,
  reduceApply,
  resultKey,
  safeHref,
  startTracking,
  stepperModel,
  validateSettingsDraft,
  validateWindow,
  type ApplyTracking,
} from '@/features/update/logic/updateLogic';
import { saveUpdateSettings } from '@/features/update/updateActions';
import { updateClock, useUpdateStore } from '@/features/update/useUpdateStore';

const RAW_STATUS = {
  api_level: 1,
  current_version: 'v1.2.0',
  latest_version: 'v1.3.0',
  update_available: true,
  release_url: 'https://github.com/iamkunal9/proxx/releases/tag/v1.3.0',
  release_notes: '## What changed\n\n- **Faster** routing\n- <script>alert(1)</script>',
  checked_at: '2026-11-17T10:00:00Z',
  last_check_error: '',
  supported: true,
  unsupported_reason: '',
  state: 'idle',
  inflight: 0,
  staged_version: '',
  config: { check: true, interval_hours: 6, auto_apply: false, window: '02:00-05:00' },
  last_result: null,
};

const status = (overrides: Record<string, unknown> = {}): UpdateStatus =>
  normalizeUpdateStatus({ ...RAW_STATUS, ...overrides });

const noop = () => undefined;

const render = (overrides: Partial<UpdateViewProps> = {}) =>
  renderToStaticMarkup(
    createElement(UpdateView, {
      status: status(),
      backendTooOld: false,
      loaded: true,
      error: '',
      tracking: IDLE_TRACKING,
      checking: false,
      applying: false,
      cancelling: false,
      onApply: noop,
      onCancel: noop,
      onDismiss: noop,
      onRetry: noop,
      onCopyInstall: noop,
      ...overrides,
    })
  );

const httpError = (statusCode: number | undefined, message = 'boom') =>
  Object.assign(new Error(message), { name: 'ApiError', status: statusCode });

let originalLanguage = 'zh-CN';
beforeAll(async () => {
  originalLanguage = i18n.language;
  await i18n.changeLanguage('en');
});
afterAll(async () => {
  await i18n.changeLanguage(originalLanguage);
});

describe('update API normalization', () => {
  test('maps snake_case fields and keeps unknowns safe', () => {
    const s = status({
      state: 'waiting_idle',
      inflight: 3,
      staged_version: 'v1.3.0',
      last_result: { from: 'v1.1.0', to: 'v1.2.0', at: 'x', ok: true, rolled_back: false },
    });
    expect(s.apiLevel).toBe(1);
    expect(s.state).toBe('waiting_idle');
    expect(s.inflight).toBe(3);
    expect(s.config).toEqual({
      check: true,
      intervalHours: 6,
      autoApply: false,
      window: '02:00-05:00',
    });
    expect(s.lastResult?.ok).toBe(true);
    expect(s.lastResult?.rolledBack).toBe(false);
  });

  test('missing api_level is 0, unknown state is idle, missing supported means supported', () => {
    const s = normalizeUpdateStatus({ state: 'exploding' });
    expect(s.apiLevel).toBe(0);
    expect(s.state).toBe('idle');
    expect(s.supported).toBe(true);
    expect(s.lastResult).toBeNull();
    expect(normalizeUpdateStatus({ supported: false }).supported).toBe(false);
  });

  test('404 on the status route means the backend is too old', () => {
    expect(isUpdateRouteMissing(httpError(404))).toBe(true);
    expect(isUpdateRouteMissing(httpError(500))).toBe(false);
    expect(isUpdateRouteMissing(httpError(undefined))).toBe(false);
  });
});

describe('status rendering', () => {
  const states: UpdateState[] = [
    'idle',
    'checking',
    'downloading',
    'verifying',
    'staged',
    'waiting_idle',
    'applying',
    'failed',
  ];

  for (const state of states) {
    test(`renders the ${state} state`, () => {
      const html = render({ status: status({ state, inflight: 2, staged_version: 'v1.3.0' }) });
      expect(html).toContain(i18n.t(`proxx.update.state.${state}`));
      expect(html).toContain('v1.2.0');
      expect(html).toContain('v1.3.0');
      const stepper = html.includes('aria-label="Update progress"');
      expect(stepper).toBe(
        ['downloading', 'verifying', 'staged', 'waiting_idle', 'applying'].includes(state)
      );
      if (state === 'waiting_idle') {
        expect(html).toContain('2 requests in flight');
        expect(html).toContain('Cancel update');
      } else {
        expect(html).not.toContain('Cancel update');
      }
    });
  }

  test('idle with an update shows versions, enabled Update now, and safe markdown notes', () => {
    const html = render();
    expect(html).toContain('Current version');
    expect(html).toContain('Latest version');
    expect(html).toContain('<h2');
    expect(html).toContain('<strong>Faster</strong>');
    // Raw HTML in the notes is shown as text, never as markup.
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toMatch(/<button[^>]*class="btn btn-primary"[^>]*><span>Update now<\/span>/);
    expect(html).not.toMatch(/<button[^>]*disabled=""[^>]*><span>Update now/);
  });

  test('Update now is disabled while in progress or when nothing is available', () => {
    expect(canApplyUpdate(status(), IDLE_TRACKING)).toBe(true);
    expect(canApplyUpdate(status({ state: 'downloading' }), IDLE_TRACKING)).toBe(false);
    expect(canApplyUpdate(status({ update_available: false }), IDLE_TRACKING)).toBe(false);
    expect(
      canApplyUpdate(status({ update_available: false, staged_version: 'v1.3.0' }), IDLE_TRACKING)
    ).toBe(true);
    expect(canApplyUpdate(status(), startTracking(status(), 0))).toBe(false);
  });

  test('unsupported install shows the reason and install command and disables the button', () => {
    const html = render({
      status: status({
        supported: false,
        unsupported_reason: 'Running from a read-only Docker image',
      }),
    });
    expect(html).toContain('Running from a read-only Docker image');
    expect(html).toContain(INSTALL_COMMAND.replace(/\|/g, '|'));
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*><span>Update now<\/span>/);
    expect(canApplyUpdate(status({ supported: false }), IDLE_TRACKING)).toBe(false);
  });

  test('a 404 (old backend) shows the install-script message and command', () => {
    const html = render({ status: null, backendTooOld: true });
    expect(html).toContain('This proxx version doesn&#x27;t support in-panel updates');
    expect(html).toContain(
      'curl -fsSL https://raw.githubusercontent.com/iamkunal9/proxx/main/install.sh | sh'
    );
    expect(html).not.toContain('Update now');
  });

  test('api_level below the panel minimum shows a compatibility warning', () => {
    expect(MIN_BACKEND_API).toBe(1);
    expect(render({ status: status({ api_level: 0 }) })).toContain(
      'Backend is older than this panel expects'
    );
    expect(render()).not.toContain('Backend is older than this panel expects');
  });

  test('a rolled-back last_result shows a clear error even without tracking', () => {
    const html = render({
      status: status({
        update_available: false,
        last_result: {
          from: 'v1.2.0',
          to: 'v1.3.0',
          at: '2026-11-17T10:05:00Z',
          ok: false,
          rolled_back: true,
          error: 'health check failed: exit status 2',
        },
      }),
    });
    expect(html).toContain('Update to v1.3.0 was rolled back');
    expect(html).toContain('health check failed: exit status 2');
    expect(html).toContain('role="alert"');
  });
});

test('a dismissed rolled-back result stays hidden; unsafe release links are dropped', () => {
  const lastResult = {
    from: 'v1.2.0',
    to: 'v1.3.0',
    at: 'x',
    ok: false,
    rolled_back: true,
    error: 'boom',
  };
  const s = status({ last_result: lastResult, release_url: 'javascript:alert(1)' });
  expect(render({ status: s })).toContain('was rolled back');
  const html = render({ status: s, dismissedResult: resultKey(s.lastResult) });
  expect(html).not.toContain('was rolled back');
  expect(html).not.toContain('javascript:');
  expect(html).not.toContain('View release on GitHub');
  expect(safeHref('https://github.com/x')).toBe('https://github.com/x');
});

describe('apply tracking state machine', () => {
  const base = status({ state: 'waiting_idle', inflight: 2, staged_version: 'v1.3.0' });

  test('apply → waiting_idle → restart gap → back on the new version = success', () => {
    let t = reduceApply(IDLE_TRACKING, { type: 'started', status: base, now: 0 });
    expect(t.phase).toBe('pending');
    expect(t.targetVersion).toBe('v1.3.0');
    expect(stepperModel('waiting_idle', t).find((s) => s.status === 'active')?.id).toBe(
      'waiting_idle'
    );

    t = reduceApply(t, {
      type: 'status',
      status: status({ state: 'applying', staged_version: 'v1.3.0' }),
      now: 2000,
    });
    expect(t.phase).toBe('pending');

    t = reduceApply(t, { type: 'fetch_failed', now: 4000 });
    expect(t.phase).toBe('restarting');
    t = reduceApply(t, { type: 'fetch_failed', now: 30_000 });
    expect(t.phase).toBe('restarting');
    expect(stepperModel(undefined, t).find((s) => s.status === 'active')?.id).toBe('applying');

    t = reduceApply(t, {
      type: 'status',
      status: status({
        current_version: 'v1.3.0',
        update_available: false,
        last_result: { from: 'v1.2.0', to: 'v1.3.0', at: 'now', ok: true, rolled_back: false },
      }),
      now: 31_000,
    });
    expect(t.phase).toBe('success');
    expect(stepperModel('idle', t).every((s) => s.status === 'done')).toBe(true);
  });

  test('a new rolled-back last_result ends in rolled_back with the error', () => {
    let t = startTracking(base, 0);
    t = reduceApply(t, { type: 'fetch_failed', now: 1000 });
    t = reduceApply(t, {
      type: 'status',
      status: status({
        last_result: {
          from: 'v1.2.0',
          to: 'v1.3.0',
          at: 'now',
          ok: false,
          rolled_back: true,
          error: 'crashed on start',
        },
      }),
      now: 5000,
    });
    expect(t.phase).toBe('rolled_back');
    expect(t.error).toBe('crashed on start');
    expect(stepperModel('idle', t).find((s) => s.status === 'error')?.id).toBe('applying');
    const html = render({ tracking: t });
    expect(html).toContain('Update to v1.3.0 was rolled back');
    expect(html).toContain('crashed on start');
  });

  test('an old rolled-back result seen before the apply does not count', () => {
    const old = {
      from: 'v1.1.0',
      to: 'v1.2.0',
      at: 'old',
      ok: false,
      rolled_back: true,
      error: 'old',
    };
    const t = startTracking(status({ state: 'waiting_idle', last_result: old }), 0);
    const next = reduceApply(t, {
      type: 'status',
      status: status({ state: 'applying', last_result: old }),
      now: 1000,
    });
    expect(next.phase).toBe('pending');
  });

  test('more than 60s of failed fetches gives up with a timeout', () => {
    let t = startTracking(base, 0);
    t = reduceApply(t, { type: 'fetch_failed', now: 1000 });
    t = reduceApply(t, { type: 'fetch_failed', now: 1000 + RECONNECT_TIMEOUT_MS - 1 });
    expect(t.phase).toBe('restarting');
    t = reduceApply(t, { type: 'fetch_failed', now: 1000 + RECONNECT_TIMEOUT_MS });
    expect(t.phase).toBe('timeout');
    expect(render({ tracking: t })).toContain('proxx did not come back');
  });

  test('back on the old version with no new result fails after a grace period', () => {
    let t = startTracking(base, 0);
    t = reduceApply(t, { type: 'fetch_failed', now: 1000 });
    t = reduceApply(t, { type: 'status', status: status(), now: 2000 });
    expect(t.phase).toBe('pending');
    t = reduceApply(t, { type: 'status', status: status(), now: 2000 + STALE_VERSION_GRACE_MS });
    expect(t.phase).toBe('failed');
  });

  test('a backend-driven apply (auto-apply) starts tracking by itself', () => {
    const t = reduceApply(IDLE_TRACKING, {
      type: 'status',
      status: status({ state: 'applying' }),
      now: 0,
    });
    expect(t.phase).toBe('pending');
    expect(t.fromVersion).toBe('v1.2.0');
  });

  test('cancel before the restart stops tracking quietly after the grace period', () => {
    const t = startTracking(base, 0);
    expect(
      reduceApply(t, { type: 'status', status: status({ state: 'staged' }), now: 1000 }).phase
    ).toBe('pending');
    expect(
      reduceApply(t, { type: 'status', status: status({ state: 'staged' }), now: 20_000 }).phase
    ).toBe('idle');
  });

  test('polls every 2s while in progress or reconnecting, otherwise every 5 min', () => {
    expect(nextPollDelay(status(), IDLE_TRACKING)).toBe(POLL_IDLE_MS);
    expect(nextPollDelay(status({ state: 'downloading' }), IDLE_TRACKING)).toBe(POLL_ACTIVE_MS);
    expect(nextPollDelay(status({ state: 'staged' }), IDLE_TRACKING)).toBe(POLL_IDLE_MS);
    const restarting: ApplyTracking = { ...startTracking(base, 0), phase: 'restarting' };
    expect(nextPollDelay(null, restarting)).toBe(POLL_ACTIVE_MS);
  });
});

describe('update store flow (mocked API, injected clock)', () => {
  let now = 0;
  const realNow = updateClock.now;
  beforeEach(() => {
    now = 0;
    updateClock.now = () => now;
    useUpdateStore.getState().reset();
  });
  afterEach(() => {
    updateClock.now = realNow;
    useUpdateStore.getState().reset();
  });

  test('apply → waiting_idle → reconnect (failed fetches) → success', async () => {
    const post = spyOn(apiClient, 'post').mockResolvedValue({
      ...RAW_STATUS,
      state: 'waiting_idle',
      inflight: 1,
      staged_version: 'v1.3.0',
    } as never);
    const responses: Array<() => unknown> = [
      () => ({ ...RAW_STATUS, state: 'applying', staged_version: 'v1.3.0' }),
      () => {
        throw httpError(undefined, 'Network Error');
      },
      () => {
        throw httpError(undefined, 'Network Error');
      },
      () => ({
        ...RAW_STATUS,
        current_version: 'v1.3.0',
        update_available: false,
        last_result: { from: 'v1.2.0', to: 'v1.3.0', at: 'now', ok: true, rolled_back: false },
      }),
    ];
    const get = spyOn(apiClient, 'get').mockImplementation((async () =>
      responses.shift()!()) as never);
    try {
      const store = useUpdateStore.getState();
      await store.apply();
      expect(post).toHaveBeenCalledWith('/proxx/update/apply');
      expect(useUpdateStore.getState().tracking.phase).toBe('pending');
      expect(useUpdateStore.getState().status?.state).toBe('waiting_idle');

      now = 2000;
      await store.refresh();
      expect(useUpdateStore.getState().tracking.phase).toBe('pending');
      now = 4000;
      await store.refresh();
      expect(useUpdateStore.getState().tracking.phase).toBe('restarting');
      expect(useUpdateStore.getState().error).toBe('');
      now = 5000;
      await store.refresh();
      expect(useUpdateStore.getState().tracking.phase).toBe('restarting');
      now = 6000;
      await store.refresh();
      const state = useUpdateStore.getState();
      expect(state.tracking.phase).toBe('success');
      expect(state.status?.currentVersion).toBe('v1.3.0');
      expect(get).toHaveBeenCalledWith('/proxx/update');
    } finally {
      post.mockRestore();
      get.mockRestore();
    }
  });

  test('apply rejected with 409 surfaces the backend error and does not track', async () => {
    const post = spyOn(apiClient, 'post').mockRejectedValue(
      httpError(409, 'nothing to apply') as never
    );
    try {
      await expect(useUpdateStore.getState().apply()).rejects.toThrow('nothing to apply');
      expect(useUpdateStore.getState().tracking.phase).toBe('idle');
    } finally {
      post.mockRestore();
    }
  });

  test('404 on GET marks the backend as too old', async () => {
    const get = spyOn(apiClient, 'get').mockRejectedValue(httpError(404) as never);
    try {
      await useUpdateStore.getState().refresh();
      expect(useUpdateStore.getState().backendTooOld).toBe(true);
      expect(useUpdateStore.getState().status).toBeNull();
    } finally {
      get.mockRestore();
    }
  });

  test('cancel posts to /cancel and stops tracking', async () => {
    const post = spyOn(apiClient, 'post').mockImplementation((async (url: string) =>
      url.endsWith('/cancel')
        ? { ...RAW_STATUS, state: 'staged', staged_version: 'v1.3.0' }
        : { ...RAW_STATUS, state: 'waiting_idle', staged_version: 'v1.3.0' }) as never);
    try {
      await useUpdateStore.getState().apply();
      await useUpdateStore.getState().cancel();
      expect(post).toHaveBeenLastCalledWith('/proxx/update/cancel');
      expect(useUpdateStore.getState().tracking.phase).toBe('idle');
      expect(useUpdateStore.getState().status?.state).toBe('staged');
    } finally {
      post.mockRestore();
    }
  });
});

describe('settings', () => {
  test('window validation allows overnight windows and rejects bad input', () => {
    expect(validateWindow({ anyTime: true, start: '', end: '' })).toBe('');
    expect(validateWindow({ anyTime: false, start: '02:00', end: '05:00' })).toBe('');
    expect(validateWindow({ anyTime: false, start: '22:00', end: '04:00' })).toBe('');
    expect(validateWindow({ anyTime: false, start: '02:00', end: '' })).toBe('window_incomplete');
    expect(validateWindow({ anyTime: false, start: '24:00', end: '05:00' })).toBe('window_invalid');
    expect(validateWindow({ anyTime: false, start: '2:00', end: '05:00' })).toBe('window_invalid');
    expect(validateWindow({ anyTime: false, start: '03:00', end: '03:00' })).toBe('window_same');
  });

  test('window parse/format round-trips; empty means any time', () => {
    expect(parseWindow('')).toEqual({ anyTime: true, start: '', end: '' });
    expect(parseWindow('2:00-05:30')).toEqual({ anyTime: false, start: '02:00', end: '05:30' });
    expect(formatWindow({ anyTime: false, start: '22:00', end: '04:00' })).toBe('22:00-04:00');
    expect(formatWindow({ anyTime: true, start: '22:00', end: '04:00' })).toBe('');
  });

  test('interval must be a whole number of hours in range', () => {
    expect(parseIntervalHours('6')).toBe(6);
    expect(parseIntervalHours('0')).toBeUndefined();
    expect(parseIntervalHours('1.5')).toBeUndefined();
    expect(parseIntervalHours('721')).toBeUndefined();
    expect(parseIntervalHours('abc')).toBeUndefined();
  });

  test('draft validation blocks saving and the form shows the errors', () => {
    const invalid = {
      check: true,
      interval: '0',
      autoApply: true,
      window: { anyTime: false, start: '03:00', end: '03:00' },
    };
    const result = validateSettingsDraft(invalid);
    expect(result.config).toBeNull();
    const html = renderToStaticMarkup(
      createElement(UpdateSettings, {
        config: status().config,
        onSave: noop,
        initialDraft: invalid,
      })
    );
    expect(html).toContain('Enter a whole number of hours between 1 and 720.');
    expect(html).toContain('Start and end must differ.');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*type="submit"/);
  });

  test('only changed keys are written, each as a PUT to its config path', async () => {
    const original = status().config;
    const next = { check: false, intervalHours: 12, autoApply: true, window: '' };
    expect(diffUpdateConfig(original, original)).toEqual([]);
    expect(diffUpdateConfig(original, next).map((c) => c.key)).toEqual([
      'check',
      'interval-hours',
      'auto-apply',
      'window',
    ]);
    const put = spyOn(apiClient, 'put').mockResolvedValue(undefined as never);
    try {
      const written = await saveUpdateSettings(original, next, noop);
      expect(written).toBe(4);
      expect(put.mock.calls).toEqual([
        ['/config/proxx/update/check', false],
        ['/config/proxx/update/interval-hours', 12],
        ['/config/proxx/update/auto-apply', true],
        ['/config/proxx/update/window', ''],
      ]);
      put.mockClear();
      await saveUpdateSettings(original, { ...original, window: '22:00-04:00' }, noop);
      expect(put.mock.calls).toEqual([['/config/proxx/update/window', '22:00-04:00']]);
    } finally {
      put.mockRestore();
    }
  });

  test('config paths and check endpoint', async () => {
    expect(updateConfigPath('interval-hours')).toBe('/config/proxx/update/interval-hours');
    const post = spyOn(apiClient, 'post').mockResolvedValue(RAW_STATUS as never);
    try {
      const s = await proxxUpdateApi.check();
      expect(post).toHaveBeenCalledWith('/proxx/update/check');
      expect(s.latestVersion).toBe('v1.3.0');
    } finally {
      post.mockRestore();
    }
  });
});

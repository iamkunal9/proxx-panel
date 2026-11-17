/**
 * Local mock of the proxx self-update API, for developing and screenshotting the Updates page
 * without a backend. Not part of the build.
 *
 *   bun run build && bun scripts/mock-update-server.ts [--port 8398] [--scenario NAME]
 *       [--tick 1500] [--gap 1200] [--inflight 3]
 *
 * Scenarios:
 *   available    (default) v1.2.0 running, v1.3.0 available; apply succeeds.
 *   rollback     apply runs, the restarted binary "fails" and proxx rolls back to v1.2.0.
 *   unsupported  `supported: false` with a reason; apply answers 409.
 *   uptodate     no update available; apply answers 409.
 *   old          the update route answers 404 (proxx build without in-panel updates).
 *
 * Apply flow: downloading → verifying → staged → waiting_idle (in-flight count drops by one per
 * --tick ms) → applying → restart. The restart really stops the HTTP listener for --gap ms, so
 * requests fail at the network level like a real re-exec, then the server comes back.
 * Open the printed URL and log in with any management key.
 */

const args = process.argv.slice(2);
const flag = (name: string, fallback: string) => {
  const index = args.indexOf(`--${name}`);
  return index !== -1 && args[index + 1] ? args[index + 1] : fallback;
};
const port = Number(flag('port', '8398'));
const scenario = flag('scenario', 'available');
const tick = Number(flag('tick', '1500'));
const gap = Number(flag('gap', '1200'));
const startInflight = Number(flag('inflight', '3'));
const PREFIX = '/v8/management';

type State =
  | 'idle'
  | 'checking'
  | 'downloading'
  | 'verifying'
  | 'staged'
  | 'waiting_idle'
  | 'applying'
  | 'failed';

const NOTES = `## proxx v1.3.0

### Highlights
- **In-panel self-update**: check, download, verify and apply new releases from the panel.
- Zero-downtime restart: the new binary takes over the listener once no requests are in flight.
- Automatic rollback when the new version fails its health check.

### Fixes
- Request log: failed requests without usage now show unknown tokens instead of \`0\`.
- Installer waits for the old process to exit before restarting.

See the [full changelog](https://github.com/iamkunal9/proxx/releases) for details.

<script>alert('raw html is never rendered')</script>
`;

const update = {
  api_level: 1,
  current_version: 'v1.2.0',
  latest_version: scenario === 'uptodate' ? 'v1.2.0' : 'v1.3.0',
  update_available: scenario !== 'uptodate',
  release_url: 'https://github.com/iamkunal9/proxx/releases/tag/v1.3.0',
  release_notes: NOTES,
  checked_at: new Date(Date.now() - 12 * 60 * 1000).toISOString(),
  last_check_error: '',
  supported: scenario !== 'unsupported',
  unsupported_reason:
    scenario === 'unsupported'
      ? 'proxx is running from a read-only location (/usr/local/bin/proxx is owned by root).'
      : '',
  state: 'idle' as State,
  inflight: 0,
  staged_version: '',
  config: { check: true, interval_hours: 6, auto_apply: false, window: '02:00-05:00' },
  last_result: null as null | Record<string, unknown>,
};

const config: Record<string, unknown> = {
  check: true,
  'interval-hours': 6,
  'auto-apply': false,
  window: '02:00-05:00',
};

let timers: ReturnType<typeof setTimeout>[] = [];
const later = (ms: number, fn: () => void) => timers.push(setTimeout(fn, ms));
const clearTimers = () => {
  timers.forEach(clearTimeout);
  timers = [];
};

function setState(state: State) {
  update.state = state;
  console.log(`[mock] state → ${state}${state === 'waiting_idle' ? ` (${update.inflight} in flight)` : ''}`);
}

function runApply() {
  const target = update.staged_version || update.latest_version;
  const from = update.current_version;
  const toWaiting = () => {
    update.staged_version = target;
    setState('staged');
    later(tick / 2, () => {
      update.inflight = startInflight;
      setState('waiting_idle');
      const drain = () => {
        if (update.inflight > 0) {
          update.inflight -= 1;
          console.log(`[mock] in flight: ${update.inflight}`);
          later(tick, drain);
          return;
        }
        setState('applying');
        later(tick, () => restart(from, target));
      };
      later(tick, drain);
    });
  };
  if (update.staged_version) return toWaiting();
  setState('downloading');
  later(tick, () => {
    setState('verifying');
    later(tick, toWaiting);
  });
}

function restart(from: string, target: string) {
  console.log(`[mock] restarting: listener down for ${gap} ms`);
  server.stop(true);
  setTimeout(() => {
    const ok = scenario !== 'rollback';
    update.current_version = ok ? target : from;
    update.latest_version = target;
    update.update_available = !ok;
    update.staged_version = '';
    update.inflight = 0;
    update.state = 'idle';
    update.last_result = {
      from,
      to: target,
      at: new Date().toISOString(),
      ok,
      rolled_back: !ok,
      error: ok ? '' : 'new binary exited during health check: listen tcp :8317: bind: address already in use',
    };
    server = serve();
    console.log(`[mock] back up on ${update.current_version}${ok ? '' : ' (rolled back)'}`);
  }, gap);
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });

const dist = Bun.file(new URL('../dist/index.html', import.meta.url));

const statusBody = () => ({ ...update, config: { ...update.config } });

async function handle(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname;
  if (path === '/' || path === '/index.html' || path === '/management.html') {
    return new Response(dist, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  }
  if (!path.startsWith(PREFIX)) return new Response('not found', { status: 404 });
  const api = path.slice(PREFIX.length);

  if (api === '/config' && req.method === 'GET') {
    return json({ proxx: { update: config } });
  }
  const configMatch = /^\/config\/proxx\/update\/(check|interval-hours|auto-apply|window)$/.exec(api);
  if (configMatch && req.method === 'PUT') {
    const body = await req.json();
    // The v8 config API takes the raw value; also accept a {"value": ...} wrapper.
    const value =
      body && typeof body === 'object' && !Array.isArray(body) && 'value' in body ? body.value : body;
    const key = configMatch[1];
    config[key] = value;
    if (key === 'check') update.config.check = Boolean(value);
    if (key === 'interval-hours') update.config.interval_hours = Number(value);
    if (key === 'auto-apply') update.config.auto_apply = Boolean(value);
    if (key === 'window') update.config.window = String(value ?? '');
    console.log(`[mock] PUT config proxx.update.${key} = ${JSON.stringify(value)}`);
    return json({ status: 'ok' });
  }

  if (api.startsWith('/proxx/update')) {
    if (scenario === 'old') return new Response('404 page not found', { status: 404 });
    if (api === '/proxx/update' && req.method === 'GET') return json(statusBody());
    if (api === '/proxx/update/check' && req.method === 'POST') {
      setState('checking');
      await Bun.sleep(600);
      update.checked_at = new Date().toISOString();
      setState('idle');
      return json(statusBody());
    }
    if (api === '/proxx/update/apply' && req.method === 'POST') {
      if (!update.supported) return json({ error: update.unsupported_reason || 'unsupported' }, 409);
      if (!update.update_available && !update.staged_version) {
        return json({ error: 'nothing to apply: already on the latest version' }, 409);
      }
      if (!['idle', 'staged', 'failed'].includes(update.state)) {
        return json({ error: `an update is already in progress (${update.state})` }, 409);
      }
      runApply();
      return json(statusBody(), 202);
    }
    if (api === '/proxx/update/cancel' && req.method === 'POST') {
      if (update.state === 'applying') return json({ error: 'too late to cancel: applying' }, 409);
      clearTimers();
      update.inflight = 0;
      setState(update.staged_version ? 'staged' : 'idle');
      return json(statusBody());
    }
  }
  return json({ error: 'not implemented in mock' }, 404);
}

const serve = () => Bun.serve({ port, idleTimeout: 0, fetch: handle });
let server = serve();

console.log(`proxx update mock: http://localhost:${port}/  (scenario: ${scenario})`);

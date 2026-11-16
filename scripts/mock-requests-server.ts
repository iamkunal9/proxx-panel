/**
 * Local mock of the proxx request-log API, for developing and screenshotting the Requests page
 * without a backend. Not part of the build.
 *
 *   bun run build && bun scripts/mock-requests-server.ts [--port 8399] [--logging-off]
 *
 * Open http://localhost:8399/ and log in with any management key. It serves dist/index.html,
 * a minimal v8 `/config`, and the `/v8/management/proxx/requests*` contract with synthetic data.
 */

const args = process.argv.slice(2);
const port = Number(args[args.indexOf('--port') + 1]) || 8399;
let loggingOn = !args.includes('--logging-off');
const PREFIX = '/v8/management';
const BASE = `http://localhost:${port}`;

type Row = Record<string, unknown> & { id: string; time_ms: number };
type Detail = Record<string, unknown>;

const rows: Row[] = [];
const details = new Map<string, Detail>();

const MODELS = [
  { group: 'smart', requested: 'smart', served: 'claude-opus-4-1', provider: 'claude', path: '/v1/messages' },
  { group: '', requested: 'gpt-5', served: 'gpt-5', provider: 'codex', path: '/v1/responses' },
  { group: 'fast', requested: 'fast', served: 'gemini-2.5-flash', provider: 'gemini-cli', path: '/v1beta/models/gemini-2.5-flash:streamGenerateContent' },
  { group: '', requested: 'gpt-4.1-mini', served: 'gpt-4.1-mini', provider: 'openai-compat', path: '/v1/chat/completions' },
  { group: '', requested: 'claude-sonnet-4-5', served: 'claude-sonnet-4-5', provider: 'claude', path: '/v1/chat/completions' },
];

let seq = 0;
const rand = (n: number) => Math.floor(Math.random() * n);

function makeId(ms: number) {
  seq += 1;
  return `${new Date(ms).toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}-${String(seq).padStart(5, '0')}`;
}

function chatBody(path: string, model: string, withTool: boolean) {
  if (path.includes('/messages')) {
    return {
      model,
      max_tokens: 4096,
      system: [{ type: 'text', text: 'You are a careful senior engineer. Answer concisely.' }],
      tools: [{ name: 'read_file', description: 'Read a file', input_schema: { type: 'object' } }],
      messages: [
        { role: 'user', content: [{ type: 'text', text: 'Why does `go test ./...` fail in **internal/usage**? Here is the log:' }, { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'iVBORw0' } }] },
        ...(withTool
          ? [
              { role: 'assistant', content: [{ type: 'thinking', thinking: 'The failure mentions a nil map; I should read the aggregator.' }, { type: 'tool_use', id: 'toolu_01A', name: 'read_file', input: { path: 'internal/usage/aggregator.go', lines: [1, 80] } }] },
              { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_01A', content: [{ type: 'text', text: 'package usage\n\ntype Aggregator struct {\n\tbuckets map[string]*Bucket\n}\n' }] }] },
            ]
          : []),
      ],
      stream: true,
    };
  }
  if (path.includes('/responses')) {
    return {
      model,
      instructions: 'You are Codex, a coding agent.',
      input: [
        { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'List the files in the repo root and summarize the README.' }] },
        ...(withTool
          ? [
              { type: 'function_call', call_id: 'call_7Yx', name: 'shell', arguments: '{"command":["ls","-la"]}' },
              { type: 'function_call_output', call_id: 'call_7Yx', output: 'README.md\ncmd\ninternal\ngo.mod' },
            ]
          : []),
      ],
      tools: [{ type: 'function', name: 'shell' }],
      stream: true,
    };
  }
  if (path.includes('generateContent')) {
    return {
      systemInstruction: { parts: [{ text: 'Reply in one paragraph.' }] },
      contents: [{ role: 'user', parts: [{ text: 'Explain round-robin load balancing in two sentences.' }] }],
      generationConfig: { thinkingConfig: { thinkingBudget: 1024 } },
    };
  }
  return {
    model,
    messages: [
      { role: 'system', content: 'You are a helpful assistant.' },
      { role: 'user', content: 'What is the weather in Paris right now? Use the tool.' },
      ...(withTool
        ? [
            { role: 'assistant', content: null, tool_calls: [{ id: 'call_abc123', type: 'function', function: { name: 'get_weather', arguments: '{"city":"Paris","unit":"celsius"}' } }] },
            { role: 'tool', tool_call_id: 'call_abc123', content: '{"temp":18,"condition":"light rain","humidity":0.82}' },
          ]
        : []),
    ],
    tools: [{ type: 'function', function: { name: 'get_weather', parameters: { type: 'object' } } }],
    stream: false,
  };
}

const ANSWER = `It is **18 °C with light rain** in Paris right now.

- Humidity: 82%
- Bring an umbrella ☔

\`\`\`json
{ "temp": 18, "condition": "light rain" }
\`\`\`

Source: [weather API](https://example.com/weather).`;

function sseFor(text: string) {
  const words = text.split(/(?<=\s)/);
  const events = [{ event: 'message_start', data: '{"type":"message_start","message":{"id":"msg_01","role":"assistant"}}' }];
  for (let i = 0; i < words.length; i += 3) {
    events.push({
      event: 'content_block_delta',
      data: JSON.stringify({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: words.slice(i, i + 3).join('') } }),
    });
  }
  events.push({ event: 'message_delta', data: '{"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":212}}' });
  events.push({ event: 'message_stop', data: '{"type":"message_stop"}' });
  return events;
}

const maskedHeaders = (extra: Record<string, string[]> = {}) => ({
  Authorization: ['Bearer sk-pr****9f2a'],
  'Content-Type': ['application/json'],
  'User-Agent': ['claude-cli/2.0.14 (external, cli)'],
  'X-Stainless-Lang': ['js'],
  ...extra,
});

function buildRaw(row: Row, detail: Detail): string {
  const client = detail.client as Record<string, unknown>;
  const lines = [
    '=== REQUEST INFO ===',
    'Version: proxx-mock',
    `URL: ${client.url}`,
    `Method: ${client.method}`,
    `Timestamp: ${row.time}`,
    '',
    '=== HEADERS ===',
    ...Object.entries(client.headers as Record<string, string[]>).map(([k, v]) => `${k}: ${v.join(', ')}`),
    '',
    '=== REQUEST BODY ===',
    String(client.body),
    '',
  ];
  (detail.attempts as Record<string, unknown>[]).forEach((attempt) => {
    lines.push(`=== API REQUEST ${attempt.index} ===`, `Timestamp: ${attempt.timestamp}`, `Upstream URL: ${attempt.url}`, `HTTP Method: ${attempt.method}`, 'Body:', String(attempt.body), '');
    lines.push(`=== API RESPONSE ${attempt.index} ===`, `Status: ${attempt.status}`, String(attempt.response_body || attempt.error), '');
  });
  const response = detail.response as Record<string, unknown>;
  lines.push('=== RESPONSE ===', `Status: ${response.status}`);
  const events = response.sse_events as { event: string; data: string }[] | null;
  if (events) for (const event of events) lines.push(`event: ${event.event}`, `data: ${event.data}`, '');
  else lines.push(String(response.body));
  return lines.join('\n');
}

function makeRequest(ms: number, forced?: { failover?: boolean; tool?: boolean; kind?: number; status?: number }) {
  const kind = forced?.kind ?? rand(MODELS.length);
  const m = MODELS[kind];
  const failover = forced?.failover ?? Math.random() < 0.12;
  const status = forced?.status ?? (Math.random() < 0.06 ? 500 : Math.random() < 0.06 ? 429 : 200);
  const withTool = forced?.tool ?? (kind === 3 || Math.random() < 0.5);
  const stream = !m.path.includes('chat/completions');
  const body = JSON.stringify(chatBody(m.path, m.requested, withTool), null, 2);
  const id = makeId(ms);
  const input = 800 + rand(40_000);
  const output = status === 200 ? 50 + rand(2_000) : null;
  const reasoning = status === 200 && Math.random() < 0.4 ? rand(1500) : null;
  const duration = 300 + rand(14_000);
  const cost = status === 200 ? (input * 3 + (output ?? 0) * 15) / 1e6 : null;
  const upstreamUrl = m.provider === 'claude' ? 'https://api.anthropic.com/v1/messages?beta=true' : m.provider === 'codex' ? 'https://chatgpt.com/backend-api/codex/responses' : m.provider === 'gemini-cli' ? 'https://cloudcode-pa.googleapis.com/v1internal:streamGenerateContent?alt=sse' : 'https://api.openai-compatible.example/v1/chat/completions';
  const attempts = [];
  const t0 = new Date(ms).toISOString();
  if (failover) {
    attempts.push({
      index: 1, url: upstreamUrl, method: 'POST', headers: maskedHeaders({ 'Anthropic-Version': ['2023-06-01'] }), body, body_truncated: false,
      status: 429, response_headers: { 'Retry-After': ['31'], 'Content-Type': ['application/json'] },
      response_body: '{"type":"error","error":{"type":"rate_limit_error","message":"This request would exceed your account\'s rate limit."}}',
      response_truncated: false, error: '', timestamp: t0,
    });
  }
  const finalStatus = status;
  attempts.push({
    index: attempts.length + 1, url: upstreamUrl, method: 'POST', headers: maskedHeaders(), body, body_truncated: false,
    status: finalStatus, response_headers: { 'Content-Type': [stream ? 'text/event-stream' : 'application/json'], 'Request-Id': ['req_011CU' + rand(1e6)] },
    response_body: finalStatus === 200 ? (stream ? '' : JSON.stringify({ id: 'chatcmpl-1', choices: [{ index: 0, message: { role: 'assistant', content: ANSWER } }] })) : '{"error":{"message":"upstream overloaded","code":"server_error"}}',
    response_truncated: false, error: finalStatus >= 500 ? 'upstream returned 500: overloaded_error' : '', timestamp: new Date(ms + (failover ? 1240 : 0)).toISOString(),
  });
  const sseEvents = stream && finalStatus === 200 ? sseFor(ANSWER) : null;
  const row: Row = {
    id, file: `v1-${m.path.split('/').pop()?.split(':')[0]}-${id}.log`, time: new Date(ms).toISOString(), time_ms: ms,
    method: 'POST', path: m.path, status: finalStatus, duration_ms: duration, stream,
    requested_model: m.requested, served_model: m.served, group: m.group, provider: m.provider,
    input_tokens: input, output_tokens: output, reasoning_tokens: reasoning, cached_tokens: Math.random() < 0.5 ? rand(input) : null,
    cost_usd: cost, cost_source: cost === null ? 'unknown' : 'catalog', attempts: attempts.length, error: finalStatus >= 400, size_bytes: 4_000 + rand(400_000),
  };
  const detail: Detail = {
    row,
    client: { url: `http://localhost:8317${m.path}`, method: 'POST', headers: maskedHeaders({ 'Content-Length': [String(body.length)], Host: ['localhost:8317'] }), body, body_truncated: false },
    attempts,
    response: {
      status: finalStatus,
      headers: { 'Content-Type': [stream ? 'text/event-stream' : 'application/json'], 'X-Proxx-Provider': [m.provider] },
      body: stream ? '' : attempts[attempts.length - 1].response_body,
      body_truncated: false,
      sse_events: sseEvents,
      assembled: sseEvents ? { text: ANSWER, reasoning: reasoning ? 'User wants the weather; the tool returned 18 °C and rain. Format with a short list.' : '', tool_calls: [] } : null,
    },
    websocket_timeline: '',
    api_websocket_timeline: '',
    raw_size_bytes: row.size_bytes,
  };
  details.set(id, detail);
  return row;
}

if (loggingOn) {
  const now = Date.now();
  for (let i = 0; i < 400; i++) rows.push(makeRequest(now - i * 47_000 - rand(30_000)));
  // Deterministic showcase rows at the top.
  rows.unshift(makeRequest(now - 20_000, { kind: 0, failover: true, tool: true, status: 200 }));
  rows.unshift(makeRequest(now - 9_000, { kind: 3, failover: false, tool: true, status: 200 }));
  rows.sort((a, b) => b.time_ms - a.time_ms);
}

const subscribers = new Set<ReadableStreamDefaultController<Uint8Array>>();
const encoder = new TextEncoder();
setInterval(() => {
  if (!loggingOn) return;
  const row = makeRequest(Date.now());
  rows.unshift(row);
  for (const controller of subscribers) {
    try {
      controller.enqueue(encoder.encode(`event: request\ndata: ${JSON.stringify(row)}\n\n`));
    } catch {
      subscribers.delete(controller);
    }
  }
}, 5_000);
setInterval(() => {
  for (const controller of subscribers) {
    try {
      controller.enqueue(encoder.encode(': ping\n\n'));
    } catch {
      subscribers.delete(controller);
    }
  }
}, 15_000);

function matches(row: Row, url: URL): boolean {
  const p = url.searchParams;
  const status = p.get('status');
  const s = Number(row.status);
  if (status === '2xx' && !(s >= 200 && s < 300)) return false;
  if (status === '4xx' && !(s >= 400 && s < 500)) return false;
  if (status === '5xx' && !(s >= 500)) return false;
  if (status === 'error' && !row.error) return false;
  const model = p.get('model');
  if (model && ![row.group, row.requested_model, row.served_model].includes(model)) return false;
  const provider = p.get('provider');
  if (provider && row.provider !== provider) return false;
  const since = Number(p.get('since'));
  if (since && row.time_ms < since) return false;
  const until = Number(p.get('until'));
  if (until && row.time_ms > until) return false;
  const q = p.get('q')?.toLowerCase();
  if (q) {
    const detail = details.get(row.id);
    const hay = `${JSON.stringify(row)} ${(detail?.client as Record<string, unknown>)?.body ?? ''}`.toLowerCase();
    if (!hay.includes(q)) return false;
  }
  return true;
}

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

const dist = Bun.file(new URL('../dist/index.html', import.meta.url));

Bun.serve({
  port,
  idleTimeout: 0,
  async fetch(req) {
    const url = new URL(req.url);
    const path = url.pathname;
    if (path === '/' || path === '/index.html' || path === '/management.html') {
      return new Response(dist, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    }
    if (!path.startsWith(PREFIX)) return new Response('not found', { status: 404 });
    const api = path.slice(PREFIX.length);

    if (api === '/config' && req.method === 'GET') {
      return json({ observability: { logs: { 'request-log': loggingOn, 'logs-max-total-size-mb': 10240 } } });
    }
    if (api === '/config/observability/logs/request-log' && req.method === 'PUT') {
      loggingOn = Boolean(await req.json());
      return json({ status: 'ok' });
    }
    if (api === '/proxx/requests/stream') {
      let ref: ReadableStreamDefaultController<Uint8Array>;
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          ref = controller;
          subscribers.add(controller);
          controller.enqueue(encoder.encode(': connected\n\n'));
        },
        cancel() {
          subscribers.delete(ref);
        },
      });
      return new Response(stream, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' } });
    }
    if (api === '/proxx/requests' && req.method === 'GET') {
      const limit = Math.min(500, Number(url.searchParams.get('limit')) || 50);
      const cursor = Number(url.searchParams.get('cursor')) || 0;
      const filtered = rows.filter((row) => matches(row, url));
      const items = filtered.slice(cursor, cursor + limit);
      const total = rows.reduce((sum, row) => sum + Number(row.size_bytes), 0) * 40;
      return json({
        items,
        next_cursor: cursor + limit < filtered.length ? String(cursor + limit) : '',
        request_log_enabled: loggingOn,
        total_size_bytes: total,
        max_total_size_bytes: 10 * 1024 ** 3,
        log_dir: '/home/proxx/.cli-proxy-api/logs',
      });
    }
    if (api === '/proxx/requests' && req.method === 'DELETE') {
      const removed = rows.length;
      rows.length = 0;
      details.clear();
      return json({ removed });
    }
    const match = /^\/proxx\/requests\/([^/]+)(\/raw)?$/.exec(api);
    if (match) {
      const id = decodeURIComponent(match[1]);
      const detail = details.get(id);
      if (!detail) return json({ error: 'not found' }, 404);
      if (req.method === 'DELETE') {
        details.delete(id);
        rows.splice(rows.findIndex((row) => row.id === id), 1);
        return json({ status: 'ok' });
      }
      if (match[2]) return new Response(buildRaw(detail.row as Row, detail), { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
      return json(detail);
    }
    return json({ error: 'not implemented in mock' }, 404);
  },
});

console.log(`proxx requests mock: ${BASE}/  (logging ${loggingOn ? 'on' : 'off'})`);

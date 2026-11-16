import { describe, expect, test } from 'bun:test';
import { createSseByteParser, SseParser } from '../src/features/requests/logic/sseParser';
import {
  buildTranscript,
  detectTranscriptFormat,
  type TranscriptPart,
} from '../src/features/requests/logic/transcript';
import {
  buildCurl,
  distinctValues,
  formatBytes,
  mergeRows,
  modelChain,
  rowMatchesFilters,
  searchLines,
  statusClass,
} from '../src/features/requests/logic/requestLogic';
import {
  buildRequestListParams,
  normalizeRequestDetail,
  normalizeRequestList,
  normalizeRequestRow,
} from '../src/services/api/proxxRequests';
import type { RequestRow } from '../src/types/proxx';

const kinds = (parts: TranscriptPart[]) => parts.map((part) => part.kind);

describe('SSE parser', () => {
  test('parses events split across chunks, CRLF, multi-line data and comments', () => {
    const parser = new SseParser();
    const out = [
      ...parser.push(': ping\n\nevent: requ'),
      ...parser.push('est\r'),
      ...parser.push('\ndata: {"id":"a"}\r\n\r\n'),
      ...parser.push('data: line1\ndata: line2\n'),
      ...parser.push('\n'),
    ];
    expect(out).toEqual([
      { event: 'request', data: '{"id":"a"}' },
      { event: 'message', data: 'line1\nline2' },
    ]);
  });

  test('ignores comment-only blocks and keeps an unterminated tail until end()', () => {
    const parser = new SseParser();
    expect(parser.push(': ping\n\n: ping\n\n')).toEqual([]);
    expect(parser.push('event: request\ndata: x')).toEqual([]);
    expect(parser.end()).toEqual([{ event: 'request', data: 'x' }]);
  });

  test('handles a lone CR line ending and fields without a space', () => {
    const parser = new SseParser();
    expect(parser.push('data:a\r\rdata:b')).toEqual([{ event: 'message', data: 'a' }]);
  });

  test('decodes multi-byte characters split across byte chunks', () => {
    const parser = createSseByteParser();
    const bytes = new TextEncoder().encode('event: request\ndata: héllo ✓\n\n');
    const cut = bytes.indexOf(0xe2) + 1; // inside the 3-byte check mark
    const out = [...parser.push(bytes.slice(0, cut)), ...parser.push(bytes.slice(cut))];
    expect(out).toEqual([{ event: 'request', data: 'héllo ✓' }]);
  });
});

describe('transcript reconstruction', () => {
  test('detects the format by path before body shape', () => {
    expect(detectTranscriptFormat('/v1/chat/completions', {})).toBe('openai-chat');
    expect(detectTranscriptFormat('/v1/responses', {})).toBe('openai-responses');
    expect(detectTranscriptFormat('/v1/messages', { messages: [] })).toBe('claude');
    expect(detectTranscriptFormat('/v1beta/models/g:streamGenerateContent', {})).toBe('gemini');
    expect(detectTranscriptFormat('/x', { contents: [] })).toBe('gemini');
    expect(detectTranscriptFormat('/x', { system: 's', messages: [] })).toBe('claude');
    expect(detectTranscriptFormat('/x', { messages: [] })).toBe('openai-chat');
    expect(detectTranscriptFormat('/x', { foo: 1 })).toBeNull();
  });

  test('OpenAI chat: string/parts content, tool calls, tool results, response body', () => {
    const transcript = buildTranscript({
      path: '/v1/chat/completions',
      requestBody: JSON.stringify({
        tools: [{ type: 'function', function: { name: 'get_weather' } }],
        messages: [
          { role: 'system', content: 'Be brief.' },
          {
            role: 'user',
            content: [
              { type: 'text', text: 'Weather?' },
              { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } },
            ],
          },
          {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: 'call_1',
                type: 'function',
                function: { name: 'get_weather', arguments: '{"city":"Paris"}' },
              },
            ],
          },
          { role: 'tool', tool_call_id: 'call_1', content: '{"temp":21}' },
        ],
      }),
      responseBody: JSON.stringify({
        choices: [{ message: { role: 'assistant', content: 'It is 21°C.' } }],
      }),
    });
    expect(transcript?.format).toBe('openai-chat');
    expect(transcript?.toolCount).toBe(1);
    const messages = transcript!.messages;
    expect(messages.map((m) => m.role)).toEqual([
      'system',
      'user',
      'assistant',
      'tool',
      'assistant',
    ]);
    expect(kinds(messages[1].parts)).toEqual(['text', 'image']);
    expect(messages[2].parts[0]).toEqual({
      kind: 'tool_call',
      id: 'call_1',
      name: 'get_weather',
      arguments: '{"city":"Paris"}',
    });
    expect(messages[3].parts[0]).toMatchObject({ kind: 'tool_result', id: 'call_1' });
    expect(messages[4]).toMatchObject({ fromResponse: true, parts: [{ text: 'It is 21°C.' }] });
  });

  test('OpenAI Responses: instructions, items, reasoning and assembled final turn', () => {
    const transcript = buildTranscript({
      path: '/v1/responses',
      requestBody: JSON.stringify({
        instructions: 'You are a coder.',
        input: [
          { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'ls' }] },
          { type: 'reasoning', summary: [{ type: 'summary_text', text: 'Need a shell.' }] },
          { type: 'function_call', call_id: 'fc_1', name: 'shell', arguments: '{"cmd":"ls"}' },
          { type: 'function_call_output', call_id: 'fc_1', output: 'a.txt' },
        ],
      }),
      assembled: { text: 'Found a.txt', reasoning: 'done', toolCalls: [] },
    });
    const messages = transcript!.messages;
    expect(messages.map((m) => m.role)).toEqual([
      'system',
      'user',
      'assistant',
      'tool',
      'assistant',
    ]);
    expect(kinds(messages[2].parts)).toEqual(['reasoning', 'tool_call']);
    expect(messages[3].parts[0]).toMatchObject({ kind: 'tool_result', content: 'a.txt' });
    expect(kinds(messages[4].parts)).toEqual(['reasoning', 'text']);
  });

  test('OpenAI Responses: plain string input and output parsed from body', () => {
    const transcript = buildTranscript({
      path: '/v1/responses',
      requestBody: JSON.stringify({ input: 'hi' }),
      responseBody: JSON.stringify({
        output: [
          { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'hello' }] },
        ],
      }),
    });
    expect(transcript!.messages.map((m) => m.role)).toEqual(['user', 'assistant']);
    expect(transcript!.messages[1].parts).toEqual([{ kind: 'text', text: 'hello' }]);
  });

  test('Claude: system blocks, thinking, tool_use, tool_result errors and images', () => {
    const transcript = buildTranscript({
      path: '/v1/messages',
      requestBody: JSON.stringify({
        system: [{ type: 'text', text: 'Sys prompt' }],
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'Look' },
              { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'x' } },
            ],
          },
          {
            role: 'assistant',
            content: [
              { type: 'thinking', thinking: 'hmm' },
              { type: 'tool_use', id: 'tu_1', name: 'read', input: { path: '/a' } },
            ],
          },
          {
            role: 'user',
            content: [
              {
                type: 'tool_result',
                tool_use_id: 'tu_1',
                is_error: true,
                content: [{ type: 'text', text: 'ENOENT' }],
              },
            ],
          },
        ],
      }),
      responseBody: JSON.stringify({ content: [{ type: 'text', text: 'Sorry' }] }),
    });
    const messages = transcript!.messages;
    expect(transcript!.format).toBe('claude');
    expect(messages.map((m) => m.role)).toEqual([
      'system',
      'user',
      'assistant',
      'tool',
      'assistant',
    ]);
    expect(kinds(messages[1].parts)).toEqual(['text', 'image']);
    expect(kinds(messages[2].parts)).toEqual(['reasoning', 'tool_call']);
    expect(messages[2].parts[1]).toMatchObject({ name: 'read' });
    expect(messages[3].parts[0]).toMatchObject({ isError: true, content: 'ENOENT' });
    expect(messages[4].parts).toEqual([{ kind: 'text', text: 'Sorry' }]);
  });

  test('Gemini: systemInstruction, model role, function call/response, inline data, thoughts', () => {
    const transcript = buildTranscript({
      path: '/v1beta/models/gemini-2.5-pro:generateContent',
      requestBody: JSON.stringify({
        systemInstruction: { parts: [{ text: 'Be kind' }] },
        tools: [{ functionDeclarations: [{ name: 'a' }, { name: 'b' }] }],
        contents: [
          {
            role: 'user',
            parts: [{ text: 'Hi' }, { inlineData: { mimeType: 'image/png', data: 'x' } }],
          },
          {
            role: 'model',
            parts: [
              { text: 'plan', thought: true },
              { functionCall: { name: 'a', args: { q: 1 } } },
            ],
          },
          { role: 'user', parts: [{ functionResponse: { name: 'a', response: { ok: true } } }] },
        ],
      }),
      responseBody: JSON.stringify({
        candidates: [{ content: { role: 'model', parts: [{ text: 'Done' }] } }],
      }),
    });
    const messages = transcript!.messages;
    expect(transcript!.toolCount).toBe(2);
    expect(messages.map((m) => m.role)).toEqual([
      'system',
      'user',
      'assistant',
      'tool',
      'assistant',
    ]);
    expect(kinds(messages[1].parts)).toEqual(['text', 'image']);
    expect(kinds(messages[2].parts)).toEqual(['reasoning', 'tool_call']);
    expect(messages[3].parts[0]).toMatchObject({ kind: 'tool_result', name: 'a' });
    expect(messages[4].parts).toEqual([{ kind: 'text', text: 'Done' }]);
  });

  test('returns null for unknown or invalid bodies', () => {
    expect(
      buildTranscript({ path: '/v1/embeddings', requestBody: '{"input":1,"messages":2}' })
    ).toBeNull();
    expect(buildTranscript({ path: '/v1/chat/completions', requestBody: 'not json' })).toBeNull();
    expect(buildTranscript({ path: '/x', requestBody: '{"foo":1}' })).toBeNull();
  });
});

const row = (overrides: Partial<RequestRow>): RequestRow => ({
  ...normalizeRequestRow({ id: 'r', time_ms: 1000, status: 200 }),
  ...overrides,
});

describe('requests API normalization', () => {
  test('keeps unknown numbers null instead of inventing zeros', () => {
    const normalized = normalizeRequestRow({
      id: 'a',
      status: 0,
      duration_ms: null,
      input_tokens: 12,
      cost_usd: null,
      attempts: 2,
    });
    expect(normalized.status).toBeNull();
    expect(normalized.durationMs).toBeNull();
    expect(normalized.inputTokens).toBe(12);
    expect(normalized.outputTokens).toBeNull();
    expect(normalized.costUsd).toBeNull();
    expect(normalized.attempts).toBe(2);
  });

  test('list drops rows without id and reads storage fields', () => {
    const page = normalizeRequestList({
      items: [{ id: 'a' }, { file: 'x' }],
      next_cursor: 'c2',
      request_log_enabled: true,
      total_size_bytes: 10,
      max_total_size_bytes: 0,
    });
    expect(page.items.map((item) => item.id)).toEqual(['a']);
    expect(page.nextCursor).toBe('c2');
    expect(page.requestLogEnabled).toBe(true);
    expect(page.maxTotalSizeBytes).toBe(0);
  });

  test('detail keeps bodies verbatim and sse_events null when absent', () => {
    const detail = normalizeRequestDetail({
      row: { id: 'a' },
      client: { body: '  {"a":1}\n', headers: { Accept: ['x'], 'X-One': 'y' } },
      attempts: [{ status: 429 }, { index: 2, status: 200 }],
      response: { status: 200, assembled: { text: 'hi', tool_calls: [{ id: 't', name: 'n' }] } },
    });
    expect(detail.client.body).toBe('  {"a":1}\n');
    expect(detail.client.headers).toEqual({ Accept: ['x'], 'X-One': ['y'] });
    expect(detail.attempts.map((a) => [a.index, a.status])).toEqual([
      [1, 429],
      [2, 200],
    ]);
    expect(detail.response.sseEvents).toBeNull();
    expect(detail.response.assembled?.toolCalls[0].name).toBe('n');
  });

  test('list params omit empty values', () => {
    expect(
      buildRequestListParams({ q: '', status: '', limit: 50, cursor: undefined, model: 'm' })
    ).toEqual({
      limit: 50,
      model: 'm',
    });
  });
});

describe('requests page logic', () => {
  test('status classes and live filter matching', () => {
    expect(statusClass({ status: 200, error: false })).toBe('2xx');
    expect(statusClass({ status: 429, error: false })).toBe('4xx');
    expect(statusClass({ status: null, error: true })).toBe('error');
    const filters = { status: '' as const, model: '', provider: '', q: '', range: 'all' as const };
    const r = row({ provider: 'claude', servedModel: 'opus', group: 'smart' });
    expect(rowMatchesFilters(r, filters)).toBe(true);
    expect(rowMatchesFilters(r, { ...filters, provider: 'codex' })).toBe(false);
    expect(rowMatchesFilters(r, { ...filters, model: 'smart' })).toBe(true);
    expect(rowMatchesFilters(r, { ...filters, status: '5xx' })).toBe(false);
    expect(rowMatchesFilters(r, { ...filters, range: '15m' }, 1000 + 20 * 60_000)).toBe(false);
  });

  test('merges re-delivered rows by id, newest first', () => {
    const a = row({ id: 'a', timeMs: 1 });
    const b = row({ id: 'b', timeMs: 2 });
    const merged = mergeRows(
      [b, a],
      [row({ id: 'a', timeMs: 1, status: 500 }), row({ id: 'c', timeMs: 3 })]
    );
    expect(merged.map((r) => r.id)).toEqual(['c', 'b', 'a']);
    expect(merged[2].status).toBe(500);
  });

  test('model chain prefers group, then requested model', () => {
    expect(modelChain({ group: 'smart', requestedModel: 'smart', servedModel: 'opus' })).toEqual({
      from: 'smart',
      to: 'opus',
    });
    expect(modelChain({ group: '', requestedModel: 'gpt', servedModel: 'gpt' })).toEqual({
      from: '',
      to: 'gpt',
    });
    expect(modelChain({ group: '', requestedModel: '', servedModel: '' })).toEqual({
      from: '',
      to: '',
    });
  });

  test('cURL masks the key and quotes the body safely', () => {
    const curl = buildCurl({
      method: 'POST',
      url: 'http://localhost:8317/v1/chat/completions',
      headers: {
        Authorization: ['Bearer sk-secret'],
        'Content-Length': ['10'],
        'Content-Type': ['application/json'],
      },
      body: `{"a":"it's"}`,
    });
    expect(curl).not.toContain('sk-secret');
    expect(curl).toContain('-H "Authorization: Bearer $PROXX_KEY"');
    expect(curl).not.toContain('Content-Length');
    expect(curl).toContain(`--data-raw '{"a":"it'\\''s"}'`);
  });

  test('misc helpers', () => {
    expect(formatBytes(null)).toBe('—');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(distinctValues(['b', '', 'a', 'b'], 'z')).toEqual(['a', 'b', 'z']);
    expect(searchLines(['Foo', 'bar', 'FOO bar'], 'foo')).toEqual([0, 2]);
  });
});

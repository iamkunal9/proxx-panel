/**
 * Rebuilds a chat transcript from a logged client request body and its final response.
 *
 * Supported request formats: OpenAI Chat Completions (`messages`), OpenAI Responses (`input`),
 * Claude Messages (`system` + `messages`) and Gemini (`contents`). Returns null for anything else
 * so the UI can fall back to the raw request view.
 */

import type { AssembledResponse } from '@/types/proxx';
import { isRecord } from '@/utils/helpers';

export type TranscriptFormat = 'openai-chat' | 'openai-responses' | 'claude' | 'gemini';

export type TranscriptRole = 'system' | 'developer' | 'user' | 'assistant' | 'tool';

export type TranscriptPart =
  | { kind: 'text'; text: string }
  | { kind: 'reasoning'; text: string }
  | { kind: 'image'; label: string }
  | { kind: 'file'; label: string }
  | { kind: 'tool_call'; id: string; name: string; arguments: string }
  | { kind: 'tool_result'; id: string; name: string; content: string; isError: boolean };

export interface TranscriptMessage {
  role: TranscriptRole;
  parts: TranscriptPart[];
  /** True for the turn rebuilt from the upstream response. */
  fromResponse?: boolean;
}

export interface Transcript {
  format: TranscriptFormat;
  messages: TranscriptMessage[];
  /** Number of tool definitions sent with the request. */
  toolCount: number;
}

type Json = Record<string, unknown>;

export function parseJson(text: string): unknown {
  if (!text || !text.trim()) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** Pretty JSON for display; strings that hold JSON are expanded, other strings kept as-is. */
export function prettyJson(value: unknown): string {
  if (typeof value === 'string') {
    const parsed = parseJson(value);
    return parsed === undefined ? value : JSON.stringify(parsed, null, 2);
  }
  if (value === undefined) return '';
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

const str = (value: unknown): string => (typeof value === 'string' ? value : '');
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

export function detectTranscriptFormat(path: string, body: unknown): TranscriptFormat | null {
  const lower = path.toLowerCase();
  if (lower.includes('/chat/completions')) return 'openai-chat';
  if (/\/responses(\/|$|\?)/.test(lower) || lower.endsWith('/responses')) return 'openai-responses';
  if (/\/messages(\/|$|\?)/.test(lower) || lower.endsWith('/messages')) return 'claude';
  if (lower.includes('generatecontent')) return 'gemini';
  if (!isRecord(body)) return null;
  if (Array.isArray(body.contents)) return 'gemini';
  if (body.input !== undefined && body.messages === undefined) return 'openai-responses';
  if (Array.isArray(body.messages)) {
    if (body.system !== undefined || body.anthropic_version !== undefined) return 'claude';
    const hasClaudeBlocks = body.messages.some(
      (message) =>
        isRecord(message) &&
        list(message.content).some(
          (block) =>
            isRecord(block) && ['tool_use', 'tool_result', 'thinking'].includes(str(block.type))
        )
    );
    return hasClaudeBlocks ? 'claude' : 'openai-chat';
  }
  return null;
}

const normalizeRole = (role: string, fallback: TranscriptRole = 'user'): TranscriptRole => {
  switch (role) {
    case 'system':
    case 'developer':
    case 'user':
    case 'assistant':
    case 'tool':
      return role;
    case 'model':
      return 'assistant';
    case 'function':
      return 'tool';
    default:
      return fallback;
  }
};

const imageLabel = (mime: string, source: string) =>
  [mime || 'image', source].filter(Boolean).join(' · ');

const describeUrl = (url: string): string => {
  if (!url) return '';
  if (url.startsWith('data:')) {
    const mime = url.slice(5, url.indexOf(';') > 0 ? url.indexOf(';') : 30);
    return `inline ${mime}`.trim();
  }
  return url.length > 80 ? `${url.slice(0, 77)}…` : url;
};

/** Text of a tool-result payload that may be a string, a block list or arbitrary JSON. */
function contentToText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    const texts = content.map((block) => {
      if (typeof block === 'string') return block;
      if (isRecord(block)) {
        if (typeof block.text === 'string') return block.text;
        if (block.type === 'image' || block.type === 'input_image') return '[image]';
      }
      return prettyJson(block);
    });
    return texts.join('\n');
  }
  return prettyJson(content);
}

const pushText = (parts: TranscriptPart[], text: unknown) => {
  if (typeof text === 'string' && text.length) parts.push({ kind: 'text', text });
};

/* OpenAI Chat Completions ---------------------------------------------------------------------- */

function chatContentParts(content: unknown): TranscriptPart[] {
  const parts: TranscriptPart[] = [];
  if (typeof content === 'string') pushText(parts, content);
  for (const item of list(content)) {
    if (!isRecord(item)) continue;
    const type = str(item.type);
    if (type === 'text' || type === 'input_text') pushText(parts, item.text);
    else if (type === 'image_url') {
      const url = isRecord(item.image_url) ? str(item.image_url.url) : str(item.image_url);
      parts.push({ kind: 'image', label: imageLabel('', describeUrl(url)) });
    } else if (type === 'input_audio') parts.push({ kind: 'file', label: 'audio' });
    else if (type === 'file') parts.push({ kind: 'file', label: 'file' });
    else pushText(parts, item.text);
  }
  return parts;
}

function chatToolCalls(calls: unknown): TranscriptPart[] {
  return list(calls)
    .filter(isRecord)
    .map((call) => {
      const fn = isRecord(call.function) ? call.function : {};
      return {
        kind: 'tool_call' as const,
        id: str(call.id),
        name: str(fn.name) || str(call.name),
        arguments: typeof fn.arguments === 'string' ? fn.arguments : prettyJson(fn.arguments),
      };
    });
}

function fromOpenAIChat(body: Json): TranscriptMessage[] {
  const messages: TranscriptMessage[] = [];
  for (const raw of list(body.messages)) {
    if (!isRecord(raw)) continue;
    const role = normalizeRole(str(raw.role));
    if (role === 'tool') {
      messages.push({
        role,
        parts: [
          {
            kind: 'tool_result',
            id: str(raw.tool_call_id),
            name: str(raw.name),
            content: contentToText(raw.content),
            isError: false,
          },
        ],
      });
      continue;
    }
    const parts: TranscriptPart[] = [];
    pushReasoning(parts, raw.reasoning_content ?? raw.reasoning);
    parts.push(...chatContentParts(raw.content));
    parts.push(...chatToolCalls(raw.tool_calls));
    if (isRecord(raw.function_call))
      parts.push(...chatToolCalls([{ function: raw.function_call }]));
    messages.push({ role, parts });
  }
  return messages;
}

function pushReasoning(parts: TranscriptPart[], value: unknown) {
  if (typeof value === 'string' && value.trim()) parts.push({ kind: 'reasoning', text: value });
}

function openAIChatResponse(body: unknown): TranscriptMessage | null {
  if (!isRecord(body)) return null;
  const choice = list(body.choices).find(isRecord);
  const message = choice && isRecord(choice.message) ? choice.message : null;
  if (!message) return null;
  const parts: TranscriptPart[] = [];
  pushReasoning(parts, message.reasoning_content ?? message.reasoning);
  parts.push(...chatContentParts(message.content));
  parts.push(...chatToolCalls(message.tool_calls));
  return { role: 'assistant', parts, fromResponse: true };
}

/* OpenAI Responses ----------------------------------------------------------------------------- */

function responsesItemParts(item: Json): { role: TranscriptRole; parts: TranscriptPart[] } | null {
  const type = str(item.type) || (item.role ? 'message' : '');
  switch (type) {
    case 'message': {
      const parts: TranscriptPart[] = [];
      if (typeof item.content === 'string') pushText(parts, item.content);
      for (const block of list(item.content)) {
        if (!isRecord(block)) continue;
        const blockType = str(block.type);
        if (['input_text', 'output_text', 'text', 'summary_text'].includes(blockType)) {
          pushText(parts, block.text);
        } else if (blockType === 'refusal') pushText(parts, block.refusal);
        else if (blockType === 'input_image') {
          parts.push({
            kind: 'image',
            label: imageLabel('', describeUrl(str(block.image_url) || str(block.file_id))),
          });
        } else if (blockType === 'input_file') {
          parts.push({ kind: 'file', label: str(block.filename) || 'file' });
        }
      }
      return { role: normalizeRole(str(item.role)), parts };
    }
    case 'function_call':
    case 'custom_tool_call':
      return {
        role: 'assistant',
        parts: [
          {
            kind: 'tool_call',
            id: str(item.call_id) || str(item.id),
            name: str(item.name),
            arguments: str(item.arguments) || str(item.input) || prettyJson(item.arguments),
          },
        ],
      };
    case 'function_call_output':
    case 'custom_tool_call_output':
      return {
        role: 'tool',
        parts: [
          {
            kind: 'tool_result',
            id: str(item.call_id),
            name: '',
            content: contentToText(item.output),
            isError: false,
          },
        ],
      };
    case 'reasoning': {
      const text = list(item.summary)
        .map((entry) => (isRecord(entry) ? str(entry.text) : ''))
        .concat(list(item.content).map((entry) => (isRecord(entry) ? str(entry.text) : '')))
        .filter(Boolean)
        .join('\n\n');
      return text ? { role: 'assistant', parts: [{ kind: 'reasoning', text }] } : null;
    }
    default:
      return null;
  }
}

/** Consecutive assistant items (reasoning, text, tool calls) belong to the same turn. */
function pushMerged(messages: TranscriptMessage[], next: TranscriptMessage) {
  const last = messages[messages.length - 1];
  if (last && last.role === 'assistant' && next.role === 'assistant' && !last.fromResponse) {
    last.parts.push(...next.parts);
    return;
  }
  messages.push(next);
}

function fromOpenAIResponses(body: Json): TranscriptMessage[] {
  const messages: TranscriptMessage[] = [];
  if (typeof body.instructions === 'string' && body.instructions) {
    messages.push({ role: 'system', parts: [{ kind: 'text', text: body.instructions }] });
  }
  if (typeof body.input === 'string') {
    messages.push({ role: 'user', parts: [{ kind: 'text', text: body.input }] });
    return messages;
  }
  for (const raw of list(body.input)) {
    if (!isRecord(raw)) continue;
    const message = responsesItemParts(raw);
    if (message) pushMerged(messages, message);
  }
  return messages;
}

function openAIResponsesResponse(body: unknown): TranscriptMessage | null {
  if (!isRecord(body)) return null;
  const source = isRecord(body.response) ? body.response : body;
  const output = list(source.output);
  if (!output.length) return null;
  const parts: TranscriptPart[] = [];
  for (const raw of output) {
    if (!isRecord(raw)) continue;
    const item = responsesItemParts(raw);
    if (item) parts.push(...item.parts);
  }
  return { role: 'assistant', parts, fromResponse: true };
}

/* Claude Messages ------------------------------------------------------------------------------ */

function claudeBlocks(content: unknown): TranscriptPart[] {
  const parts: TranscriptPart[] = [];
  if (typeof content === 'string') pushText(parts, content);
  for (const block of list(content)) {
    if (!isRecord(block)) continue;
    switch (str(block.type)) {
      case 'text':
        pushText(parts, block.text);
        break;
      case 'thinking':
        pushReasoning(parts, block.thinking);
        break;
      case 'redacted_thinking':
        parts.push({ kind: 'reasoning', text: '[redacted thinking]' });
        break;
      case 'image': {
        const source = isRecord(block.source) ? block.source : {};
        parts.push({
          kind: 'image',
          label: imageLabel(
            str(source.media_type),
            str(source.type) === 'url' ? str(source.url) : ''
          ),
        });
        break;
      }
      case 'document':
        parts.push({ kind: 'file', label: str(block.title) || 'document' });
        break;
      case 'tool_use':
      case 'server_tool_use':
        parts.push({
          kind: 'tool_call',
          id: str(block.id),
          name: str(block.name),
          arguments: prettyJson(block.input ?? {}),
        });
        break;
      case 'tool_result':
        parts.push({
          kind: 'tool_result',
          id: str(block.tool_use_id),
          name: '',
          content: contentToText(block.content ?? ''),
          isError: block.is_error === true,
        });
        break;
      default:
        break;
    }
  }
  return parts;
}

function fromClaude(body: Json): TranscriptMessage[] {
  const messages: TranscriptMessage[] = [];
  const systemParts = claudeBlocks(body.system);
  if (systemParts.length) messages.push({ role: 'system', parts: systemParts });
  for (const raw of list(body.messages)) {
    if (!isRecord(raw)) continue;
    const parts = claudeBlocks(raw.content);
    const role = normalizeRole(str(raw.role));
    // A user turn made only of tool results reads better as a tool turn.
    const onlyResults = parts.length > 0 && parts.every((part) => part.kind === 'tool_result');
    messages.push({ role: role === 'user' && onlyResults ? 'tool' : role, parts });
  }
  return messages;
}

function claudeResponse(body: unknown): TranscriptMessage | null {
  if (!isRecord(body) || !Array.isArray(body.content)) return null;
  return { role: 'assistant', parts: claudeBlocks(body.content), fromResponse: true };
}

/* Gemini --------------------------------------------------------------------------------------- */

function geminiParts(parts: unknown): TranscriptPart[] {
  const result: TranscriptPart[] = [];
  for (const part of list(parts)) {
    if (!isRecord(part)) continue;
    if (typeof part.text === 'string') {
      if (part.thought === true) pushReasoning(result, part.text);
      else pushText(result, part.text);
    }
    const inline = isRecord(part.inlineData)
      ? part.inlineData
      : isRecord(part.inline_data)
        ? part.inline_data
        : null;
    if (inline) {
      const mime = str(inline.mimeType) || str(inline.mime_type);
      result.push(
        mime.startsWith('image/') || !mime
          ? { kind: 'image', label: imageLabel(mime, 'inline') }
          : { kind: 'file', label: mime }
      );
    }
    const fileData = isRecord(part.fileData)
      ? part.fileData
      : isRecord(part.file_data)
        ? part.file_data
        : null;
    if (fileData) {
      result.push({
        kind: 'file',
        label: str(fileData.fileUri) || str(fileData.file_uri) || str(fileData.mimeType) || 'file',
      });
    }
    const call = isRecord(part.functionCall)
      ? part.functionCall
      : isRecord(part.function_call)
        ? part.function_call
        : null;
    if (call) {
      result.push({
        kind: 'tool_call',
        id: str(call.id),
        name: str(call.name),
        arguments: prettyJson(call.args ?? {}),
      });
    }
    const response = isRecord(part.functionResponse)
      ? part.functionResponse
      : isRecord(part.function_response)
        ? part.function_response
        : null;
    if (response) {
      result.push({
        kind: 'tool_result',
        id: str(response.id),
        name: str(response.name),
        content: prettyJson(response.response ?? {}),
        isError: false,
      });
    }
  }
  return result;
}

function fromGemini(body: Json): TranscriptMessage[] {
  const messages: TranscriptMessage[] = [];
  const system = body.systemInstruction ?? body.system_instruction;
  if (isRecord(system)) {
    const parts = geminiParts(system.parts);
    if (parts.length) messages.push({ role: 'system', parts });
  } else if (typeof system === 'string' && system) {
    messages.push({ role: 'system', parts: [{ kind: 'text', text: system }] });
  }
  for (const raw of list(body.contents)) {
    if (!isRecord(raw)) continue;
    const parts = geminiParts(raw.parts);
    const role = normalizeRole(str(raw.role), 'user');
    const onlyResults = parts.length > 0 && parts.every((part) => part.kind === 'tool_result');
    messages.push({ role: role === 'user' && onlyResults ? 'tool' : role, parts });
  }
  return messages;
}

function geminiResponse(body: unknown): TranscriptMessage | null {
  if (!isRecord(body)) return null;
  const source = isRecord(body.response) ? body.response : body;
  const candidate = list(source.candidates).find(isRecord);
  if (!candidate || !isRecord(candidate.content)) return null;
  return { role: 'assistant', parts: geminiParts(candidate.content.parts), fromResponse: true };
}

/* Public --------------------------------------------------------------------------------------- */

export function assembledToMessage(assembled: AssembledResponse): TranscriptMessage | null {
  const parts: TranscriptPart[] = [];
  pushReasoning(parts, assembled.reasoning);
  pushText(parts, assembled.text);
  for (const call of assembled.toolCalls) {
    parts.push({ kind: 'tool_call', id: call.id, name: call.name, arguments: call.arguments });
  }
  return parts.length ? { role: 'assistant', parts, fromResponse: true } : null;
}

export interface TranscriptInput {
  path: string;
  requestBody: string;
  responseBody?: string;
  assembled?: AssembledResponse | null;
}

export function buildTranscript({
  path,
  requestBody,
  responseBody = '',
  assembled = null,
}: TranscriptInput): Transcript | null {
  const body = parseJson(requestBody);
  if (!isRecord(body)) return null;
  const format = detectTranscriptFormat(path, body);
  if (!format) return null;

  let messages: TranscriptMessage[];
  let toolCount = 0;
  switch (format) {
    case 'openai-chat':
      messages = fromOpenAIChat(body);
      toolCount = list(body.tools).length || list(body.functions).length;
      break;
    case 'openai-responses':
      messages = fromOpenAIResponses(body);
      toolCount = list(body.tools).length;
      break;
    case 'claude':
      messages = fromClaude(body);
      toolCount = list(body.tools).length;
      break;
    case 'gemini':
      messages = fromGemini(body);
      toolCount = list(body.tools).reduce<number>(
        (sum, tool) =>
          sum +
          (isRecord(tool)
            ? list(tool.functionDeclarations ?? tool.function_declarations).length || 1
            : 0),
        0
      );
      break;
  }
  if (!messages.length) return null;

  let final: TranscriptMessage | null = assembled ? assembledToMessage(assembled) : null;
  if (!final && responseBody) {
    const response = parseJson(responseBody);
    final =
      format === 'openai-chat'
        ? openAIChatResponse(response)
        : format === 'openai-responses'
          ? openAIResponsesResponse(response)
          : format === 'claude'
            ? claudeResponse(response)
            : geminiResponse(response);
    if (final && !final.parts.length) final = null;
  }
  if (final) messages.push(final);

  return { format, messages, toolCount };
}

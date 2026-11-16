/**
 * Incremental Server-Sent Events parser (WHATWG event-stream rules, minus `retry`/`id` handling).
 * Feed it decoded text chunks of any size; it emits one message per blank-line terminated block.
 */

export interface SseMessage {
  event: string;
  data: string;
}

export class SseParser {
  private buffer = '';
  private eventName = '';
  private dataLines: string[] = [];
  private hasData = false;

  /** Parses as much of `chunk` as forms complete lines and returns the finished messages. */
  push(chunk: string): SseMessage[] {
    this.buffer += chunk;
    const messages: SseMessage[] = [];
    let start = 0;
    for (let i = 0; i < this.buffer.length; i++) {
      const char = this.buffer[i];
      if (char !== '\n' && char !== '\r') continue;
      // A trailing \r may be the first half of \r\n split across chunks: wait for more input.
      if (char === '\r' && i === this.buffer.length - 1) break;
      const line = this.buffer.slice(start, i);
      if (char === '\r' && this.buffer[i + 1] === '\n') i++;
      start = i + 1;
      const message = this.processLine(line);
      if (message) messages.push(message);
    }
    this.buffer = this.buffer.slice(start);
    return messages;
  }

  /** Flushes a final message that was not followed by a blank line (end of stream). */
  end(): SseMessage[] {
    const messages = this.buffer ? this.push('\n') : [];
    const last = this.processLine('');
    if (last) messages.push(last);
    this.buffer = '';
    return messages;
  }

  private processLine(line: string): SseMessage | null {
    if (line === '') {
      if (!this.hasData) {
        this.eventName = '';
        return null;
      }
      const message = { event: this.eventName || 'message', data: this.dataLines.join('\n') };
      this.eventName = '';
      this.dataLines = [];
      this.hasData = false;
      return message;
    }
    if (line.startsWith(':')) return null; // comment, e.g. `: ping`
    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? '' : line.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'event') this.eventName = value;
    else if (field === 'data') {
      this.dataLines.push(value);
      this.hasData = true;
    }
    return null;
  }
}

/** Decodes a byte stream into SSE messages; multi-byte characters may span chunks. */
export function createSseByteParser() {
  const decoder = new TextDecoder();
  const parser = new SseParser();
  return {
    push: (bytes: Uint8Array): SseMessage[] => parser.push(decoder.decode(bytes, { stream: true })),
    end: (): SseMessage[] => {
      const tail = decoder.decode();
      return [...(tail ? parser.push(tail) : []), ...parser.end()];
    },
  };
}

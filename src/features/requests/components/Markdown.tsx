/**
 * Minimal Markdown renderer that builds React elements only (no HTML strings, no
 * dangerouslySetInnerHTML), so model output can never inject markup. Supports fenced code,
 * headings, lists, block quotes, inline code, bold/italic and http(s)/mailto links.
 */

import { Fragment, memo, type ReactNode } from 'react';
import styles from './Markdown.module.scss';

const SAFE_LINK = /^(https?:\/\/|mailto:)/i;

const INLINE =
  /(`[^`\n]+`)|(\*\*[^*\n]+\*\*|__[^_\n]+__)|(\*[^*\n]+\*|_[^_\s][^_\n]*_)|(\[[^\]\n]+\]\([^)\s]+\))|(https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"])/g;

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let last = 0;
  let index = 0;
  for (const match of text.matchAll(INLINE)) {
    const start = match.index ?? 0;
    if (start > last) nodes.push(text.slice(last, start));
    const token = match[0];
    const key = `${keyPrefix}-${index++}`;
    if (match[1]) nodes.push(<code key={key}>{token.slice(1, -1)}</code>);
    else if (match[2])
      nodes.push(<strong key={key}>{renderInline(token.slice(2, -2), key)}</strong>);
    else if (match[3]) nodes.push(<em key={key}>{renderInline(token.slice(1, -1), key)}</em>);
    else if (match[4]) {
      const split = token.indexOf('](');
      const label = token.slice(1, split);
      const href = token.slice(split + 2, -1);
      nodes.push(
        SAFE_LINK.test(href) ? (
          <a key={key} href={href} target="_blank" rel="noopener noreferrer nofollow">
            {label}
          </a>
        ) : (
          <Fragment key={key}>{token}</Fragment>
        )
      );
    } else if (match[5]) {
      nodes.push(
        <a key={key} href={token} target="_blank" rel="noopener noreferrer nofollow">
          {token}
        </a>
      );
    }
    last = start + token.length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

type Block =
  | { type: 'code'; lang: string; text: string }
  | { type: 'heading'; level: number; text: string }
  | { type: 'list'; ordered: boolean; items: string[] }
  | { type: 'quote'; text: string }
  | { type: 'rule' }
  | { type: 'paragraph'; text: string };

function parseBlocks(source: string): Block[] {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const fence = /^\s*(```+|~~~+)\s*([\w+-]*)/.exec(line);
    if (fence) {
      const marker = fence[1];
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith(marker)) body.push(lines[i++]);
      i++;
      blocks.push({ type: 'code', lang: fence[2], text: body.join('\n') });
      continue;
    }
    if (!line.trim()) {
      i++;
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      blocks.push({ type: 'heading', level: heading[1].length, text: heading[2] });
      i++;
      continue;
    }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      blocks.push({ type: 'rule' });
      i++;
      continue;
    }
    const listMatch = /^\s*([-*+]|\d+[.)])\s+/.exec(line);
    if (listMatch) {
      const ordered = /\d/.test(listMatch[1]);
      const items: string[] = [];
      while (i < lines.length) {
        const item = /^\s*([-*+]|\d+[.)])\s+(.*)$/.exec(lines[i]);
        if (item) items.push(item[2]);
        else if (lines[i].trim() && /^\s{2,}/.test(lines[i]) && items.length) {
          items[items.length - 1] += `\n${lines[i].trim()}`;
        } else break;
        i++;
      }
      blocks.push({ type: 'list', ordered, items });
      continue;
    }
    if (/^\s*>/.test(line)) {
      const body: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i]))
        body.push(lines[i++].replace(/^\s*>\s?/, ''));
      blocks.push({ type: 'quote', text: body.join('\n') });
      continue;
    }
    const body: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^\s*(```|~~~|#{1,6}\s|>|[-*+]\s|\d+[.)]\s)/.test(lines[i])
    ) {
      body.push(lines[i++]);
    }
    if (!body.length) body.push(lines[i++]);
    blocks.push({ type: 'paragraph', text: body.join('\n') });
  }
  return blocks;
}

function withBreaks(text: string, key: string): ReactNode[] {
  return text
    .split('\n')
    .flatMap((line, index) =>
      index === 0
        ? renderInline(line, `${key}-${index}`)
        : [<br key={`${key}-br${index}`} />, ...renderInline(line, `${key}-${index}`)]
    );
}

export const Markdown = memo(function Markdown({ text }: { text: string }) {
  const blocks = parseBlocks(text);
  return (
    <div className={styles.markdown}>
      {blocks.map((block, index) => {
        const key = `b${index}`;
        switch (block.type) {
          case 'code':
            return (
              <pre key={key} className={styles.code} data-lang={block.lang || undefined}>
                {block.lang ? <span className={styles.lang}>{block.lang}</span> : null}
                <code>{block.text}</code>
              </pre>
            );
          case 'heading': {
            const Tag = `h${Math.min(6, block.level + 2)}` as 'h3';
            return <Tag key={key}>{renderInline(block.text, key)}</Tag>;
          }
          case 'list': {
            const Tag = block.ordered ? 'ol' : 'ul';
            return (
              <Tag key={key}>
                {block.items.map((item, itemIndex) => (
                  <li key={itemIndex}>{withBreaks(item, `${key}-${itemIndex}`)}</li>
                ))}
              </Tag>
            );
          }
          case 'quote':
            return <blockquote key={key}>{withBreaks(block.text, key)}</blockquote>;
          case 'rule':
            return <hr key={key} />;
          default:
            return <p key={key}>{withBreaks(block.text, key)}</p>;
        }
      })}
    </div>
  );
});

import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { IconChevronDown, IconCode, IconFileText } from '@/components/ui/icons';
import type { Transcript, TranscriptMessage, TranscriptPart } from '../logic/transcript';
import { prettyJson } from '../logic/transcript';
import { Markdown } from './Markdown';
import styles from './Detail.module.scss';

const COLLAPSE_CHARS = 1600;
const COLLAPSE_LINES = 28;

function isLong(text: string) {
  if (text.length > COLLAPSE_CHARS) return true;
  let lines = 1;
  for (let i = 0; i < text.length; i++)
    if (text[i] === '\n' && ++lines > COLLAPSE_LINES) return true;
  return false;
}

function LongText({ text, markdown = true }: { text: string; markdown?: boolean }) {
  const { t } = useTranslation();
  const long = isLong(text);
  const [expanded, setExpanded] = useState(false);
  return (
    <div className={long && !expanded ? styles.clamped : undefined}>
      {markdown ? <Markdown text={text} /> : <pre className={styles.pre}>{text}</pre>}
      {long ? (
        <button type="button" className={styles.showMore} onClick={() => setExpanded((v) => !v)}>
          {expanded ? t('proxx.requests.show_less') : t('proxx.requests.show_more')}
        </button>
      ) : null}
    </div>
  );
}

function Collapsible({
  className,
  icon,
  title,
  meta,
  defaultOpen = false,
  children,
}: {
  className: string;
  icon?: ReactNode;
  title: ReactNode;
  meta?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={className}>
      <button
        type="button"
        className={styles.cardHead}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <IconChevronDown size={12} className={open ? styles.chevOpen : styles.chev} />
        {icon}
        <span className={styles.cardTitle}>{title}</span>
        {meta ? <span className={styles.cardMeta}>{meta}</span> : null}
      </button>
      {open ? <div className={styles.cardBody}>{children}</div> : null}
    </div>
  );
}

function Part({ part }: { part: TranscriptPart }) {
  const { t } = useTranslation();
  switch (part.kind) {
    case 'text':
      return <LongText text={part.text} />;
    case 'reasoning':
      return (
        <Collapsible
          className={styles.reasoning}
          title={t('proxx.requests.reasoning')}
          meta={t('proxx.requests.chars_count', { count: part.text.length })}
        >
          <LongText text={part.text} />
        </Collapsible>
      );
    case 'image':
      return (
        <div className={styles.attachment}>
          <IconFileText size={13} />
          {t('proxx.requests.image')}
          {part.label ? <span className={styles.cardMeta}>{part.label}</span> : null}
        </div>
      );
    case 'file':
      return (
        <div className={styles.attachment}>
          <IconFileText size={13} />
          {part.label || t('proxx.requests.file')}
        </div>
      );
    case 'tool_call':
      return (
        <Collapsible
          className={styles.toolCard}
          icon={<IconCode size={13} />}
          title={
            <>
              <span className={styles.toolVerb}>{t('proxx.requests.tool_call')}</span>{' '}
              <span className={styles.mono}>{part.name || '—'}</span>
            </>
          }
          meta={part.id || undefined}
        >
          <pre className={styles.pre}>{prettyJson(part.arguments) || '{}'}</pre>
        </Collapsible>
      );
    case 'tool_result':
      return (
        <Collapsible
          className={part.isError ? `${styles.toolCard} ${styles.toolError}` : styles.toolCard}
          icon={<IconCode size={13} />}
          title={
            <>
              <span className={styles.toolVerb}>
                {part.isError ? t('proxx.requests.tool_error') : t('proxx.requests.tool_result')}
              </span>{' '}
              {part.name ? <span className={styles.mono}>{part.name}</span> : null}
            </>
          }
          meta={part.id || undefined}
        >
          <LongText text={prettyJson(part.content)} markdown={false} />
        </Collapsible>
      );
  }
}

function Message({ message }: { message: TranscriptMessage }) {
  const { t } = useTranslation();
  return (
    <div className={`${styles.msg} ${styles[`msg_${message.role}`]}`}>
      <div className={styles.msgRole}>
        {t(`proxx.requests.role.${message.role}`)}
        {message.fromResponse ? (
          <span className={styles.msgTag}>{t('proxx.requests.response_turn')}</span>
        ) : null}
      </div>
      <div className={styles.msgBody}>
        {message.parts.length ? (
          message.parts.map((part, index) => <Part key={index} part={part} />)
        ) : (
          <span className={styles.emptyNote}>{t('proxx.requests.empty_message')}</span>
        )}
      </div>
    </div>
  );
}

export function TranscriptView({ transcript }: { transcript: Transcript }) {
  const { t } = useTranslation();
  return (
    <div className={styles.transcript}>
      <div className={styles.transcriptMeta}>
        <span>{t(`proxx.requests.format.${transcript.format}`)}</span>
        <span>·</span>
        <span>{t('proxx.requests.messages_count', { count: transcript.messages.length })}</span>
        {transcript.toolCount ? (
          <>
            <span>·</span>
            <span>{t('proxx.requests.tools_count', { count: transcript.toolCount })}</span>
          </>
        ) : null}
      </div>
      {transcript.messages.map((message, index) => (
        <Message key={index} message={message} />
      ))}
    </div>
  );
}

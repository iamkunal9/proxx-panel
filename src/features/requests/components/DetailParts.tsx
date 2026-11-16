/** Small building blocks of the request detail panel. */

import { memo, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { IconCheck, IconChevronDown, IconCopy } from '@/components/ui/icons';
import { useNotificationStore } from '@/stores';
import type { HeaderMap } from '@/types/proxx';
import { copyToClipboard } from '@/utils/clipboard';
import { parseJson } from '../logic/transcript';
import styles from './Detail.module.scss';

export function CopyButton({
  text,
  label,
  compact = false,
}: {
  text: string;
  label?: string;
  compact?: boolean;
}) {
  const { t } = useTranslation();
  const showNotification = useNotificationStore((state) => state.showNotification);
  const [copied, setCopied] = useState(false);
  const name = label ?? t('proxx.requests.copy');
  return (
    <button
      type="button"
      className={compact ? styles.iconBtn : styles.textBtn}
      aria-label={name}
      title={name}
      disabled={!text}
      onClick={async () => {
        const ok = await copyToClipboard(text);
        if (ok) {
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1200);
        } else showNotification(t('proxx.requests.copy_failed'), 'error');
      }}
    >
      {copied ? <IconCheck size={13} /> : <IconCopy size={13} />}
      {compact ? null : <span>{copied ? t('proxx.requests.copied') : name}</span>}
    </button>
  );
}

export function TruncatedNotice({ onOpenRaw }: { onOpenRaw: () => void }) {
  const { t } = useTranslation();
  return (
    <div className={styles.truncated} role="note">
      <span>{t('proxx.requests.truncated')}</span>
      <button type="button" className={styles.linkBtn} onClick={onOpenRaw}>
        {t('proxx.requests.open_raw')}
      </button>
    </div>
  );
}

export function Section({
  title,
  actions,
  children,
  defaultOpen = true,
}: {
  title: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className={styles.section}>
      <div className={styles.sectionHead}>
        <button
          type="button"
          className={styles.sectionToggle}
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          <IconChevronDown size={13} className={open ? styles.chevOpen : styles.chev} />
          {title}
        </button>
        {actions ? <div className={styles.sectionActions}>{actions}</div> : null}
      </div>
      {open ? <div className={styles.sectionBody}>{children}</div> : null}
    </section>
  );
}

export function HeadersTable({ headers }: { headers: HeaderMap }) {
  const { t } = useTranslation();
  const entries = Object.entries(headers).sort(([a], [b]) => a.localeCompare(b));
  if (!entries.length)
    return <div className={styles.emptyNote}>{t('proxx.requests.no_headers')}</div>;
  return (
    <dl className={styles.headers}>
      {entries.map(([name, values]) => (
        <div key={name} className={styles.headerRow}>
          <dt>{name}</dt>
          <dd>{values.join(', ') || '—'}</dd>
        </div>
      ))}
    </dl>
  );
}

/* JSON tree ----------------------------------------------------------------------------------- */

const MAX_CHILDREN = 200;
const MAX_STRING = 600;

function JsonValue({ value }: { value: unknown }) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  if (value === null) return <span className={styles.jNull}>null</span>;
  if (typeof value === 'string') {
    const long = value.length > MAX_STRING;
    const shown = long && !expanded ? `${value.slice(0, MAX_STRING)}…` : value;
    return (
      <span className={styles.jString}>
        &quot;{shown}&quot;
        {long ? (
          <button type="button" className={styles.linkBtn} onClick={() => setExpanded((v) => !v)}>
            {expanded
              ? t('proxx.requests.show_less')
              : `+${(value.length - MAX_STRING).toLocaleString()}`}
          </button>
        ) : null}
      </span>
    );
  }
  if (typeof value === 'number') return <span className={styles.jNumber}>{String(value)}</span>;
  if (typeof value === 'boolean') return <span className={styles.jBool}>{String(value)}</span>;
  return <span>{String(value)}</span>;
}

const JsonNode = memo(function JsonNode({
  name,
  value,
  depth,
  defaultDepth,
}: {
  name: string | null;
  value: unknown;
  depth: number;
  defaultDepth: number;
}) {
  const isArray = Array.isArray(value);
  const isObject = value !== null && typeof value === 'object';
  const [open, setOpen] = useState(depth < defaultDepth);
  const [limit, setLimit] = useState(MAX_CHILDREN);
  const label = name !== null ? <span className={styles.jKey}>{name}: </span> : null;
  if (!isObject) {
    return (
      <div className={styles.jRow} style={{ paddingLeft: depth * 14 + 14 }}>
        {label}
        <JsonValue value={value} />
      </div>
    );
  }
  const entries: [string, unknown][] = isArray
    ? (value as unknown[]).map((item, index) => [String(index), item])
    : Object.entries(value as Record<string, unknown>);
  const summary = isArray ? `[${entries.length}]` : `{${entries.length}}`;
  return (
    <>
      <div className={styles.jRow} style={{ paddingLeft: depth * 14 }}>
        <button
          type="button"
          className={styles.jToggle}
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          disabled={!entries.length}
        >
          <IconChevronDown size={11} className={open ? styles.chevOpen : styles.chev} />
        </button>
        {label}
        <span className={styles.jSummary}>{summary}</span>
      </div>
      {open
        ? entries
            .slice(0, limit)
            .map(([key, child]) => (
              <JsonNode
                key={key}
                name={isArray ? null : key}
                value={child}
                depth={depth + 1}
                defaultDepth={defaultDepth}
              />
            ))
        : null}
      {open && entries.length > limit ? (
        <div className={styles.jRow} style={{ paddingLeft: (depth + 1) * 14 + 14 }}>
          <button
            type="button"
            className={styles.linkBtn}
            onClick={() => setLimit((v) => v + MAX_CHILDREN)}
          >
            +{(entries.length - limit).toLocaleString()}
          </button>
        </div>
      ) : null}
    </>
  );
});

/** Body viewer: a collapsible JSON tree when the text is JSON, raw text otherwise. */
export function BodyView({
  text,
  truncated,
  onOpenRaw,
  defaultDepth = 2,
  copyLabel,
}: {
  text: string;
  truncated: boolean;
  onOpenRaw: () => void;
  defaultDepth?: number;
  copyLabel?: string;
}) {
  const { t } = useTranslation();
  const parsed = useMemo(() => parseJson(text), [text]);
  const isJson = parsed !== undefined && typeof parsed === 'object' && parsed !== null;
  const [raw, setRaw] = useState(false);
  const pretty = useMemo(
    () => (isJson && raw ? JSON.stringify(parsed, null, 2) : text),
    [isJson, raw, parsed, text]
  );
  if (!text) {
    return (
      <>
        {truncated ? <TruncatedNotice onOpenRaw={onOpenRaw} /> : null}
        <div className={styles.emptyNote}>{t('proxx.requests.empty_body')}</div>
      </>
    );
  }
  return (
    <div className={styles.body}>
      {truncated ? <TruncatedNotice onOpenRaw={onOpenRaw} /> : null}
      <div className={styles.bodyBar}>
        {isJson ? (
          <button
            type="button"
            className={styles.textBtn}
            aria-pressed={raw}
            onClick={() => setRaw((v) => !v)}
          >
            {raw ? t('proxx.requests.view_tree') : t('proxx.requests.view_raw')}
          </button>
        ) : null}
        <CopyButton text={text} label={copyLabel} />
      </div>
      {isJson && !raw ? (
        <div className={styles.jsonTree}>
          <JsonNode name={null} value={parsed} depth={0} defaultDepth={defaultDepth} />
        </div>
      ) : (
        <pre className={styles.pre}>{pretty}</pre>
      )}
    </div>
  );
}

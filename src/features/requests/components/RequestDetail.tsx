import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ProxxBadge } from '@/components/proxx/ProxxPage';
import { DASH, formatLatency, formatUsd } from '@/components/proxx/format';
import { IconDownload, IconEllipsis, IconTrash2, IconX } from '@/components/ui/icons';
import { apiClient } from '@/services/api/client';
import { proxxRequestsApi } from '@/services/api/proxxRequests';
import { useNotificationStore } from '@/stores';
import type { RequestAttempt, RequestDetail as Detail, RequestRow } from '@/types/proxx';
import { getErrorMessage } from '@/utils/helpers';
import {
  buildCurl,
  formatAbsolute,
  formatBytes,
  formatCount,
  modelChain,
  rowTimeMs,
  statusTone,
  statusTone4,
} from '../logic/requestLogic';
import { buildTranscript, prettyJson } from '../logic/transcript';
import { BodyView, CopyButton, HeadersTable, Section, TruncatedNotice } from './DetailParts';
import { Markdown } from './Markdown';
import { RawViewer } from './RawViewer';
import { TranscriptView } from './TranscriptView';
import styles from './Detail.module.scss';

export type DetailTab = 'transcript' | 'request' | 'upstream' | 'response' | 'raw';
const TABS: DetailTab[] = ['transcript', 'request', 'upstream', 'response', 'raw'];

type Load<T> =
  { status: 'loading' } | { status: 'ready'; data: T } | { status: 'error'; error: string };

interface Props {
  id: string;
  row: RequestRow | null;
  tab: DetailTab;
  onTabChange: (tab: DetailTab) => void;
  onClose: () => void;
  onDeleted: (id: string) => void;
}

export function RequestDetail({ id, row: listRow, tab, onTabChange, onClose, onDeleted }: Props) {
  const { t, i18n } = useTranslation();
  const showNotification = useNotificationStore((state) => state.showNotification);
  const showConfirmation = useNotificationStore((state) => state.showConfirmation);
  const [detail, setDetail] = useState<Load<Detail>>({ status: 'loading' });
  const [raw, setRaw] = useState<Load<string> | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const requestRef = useRef(0);

  const load = useCallback(async () => {
    const requestId = ++requestRef.current;
    const revision = apiClient.getConnectionRevision();
    const isCurrent = () =>
      requestId === requestRef.current && revision === apiClient.getConnectionRevision();
    setDetail({ status: 'loading' });
    setRaw(null);
    try {
      const data = await proxxRequestsApi.get(id);
      if (isCurrent()) setDetail({ status: 'ready', data });
    } catch (error) {
      if (isCurrent())
        setDetail({ status: 'error', error: getErrorMessage(error, 'Request failed') });
    }
  }, [id]);

  useEffect(() => {
    void load();
    return () => {
      requestRef.current += 1;
    };
  }, [load]);

  // The raw file is loaded lazily, the first time the Raw tab is shown.
  useEffect(() => {
    if (tab !== 'raw' || raw) return;
    const requestId = requestRef.current;
    setRaw({ status: 'loading' });
    proxxRequestsApi
      .raw(id)
      .then((text) => {
        if (requestId === requestRef.current) setRaw({ status: 'ready', data: text });
      })
      .catch((error: unknown) => {
        if (requestId === requestRef.current)
          setRaw({ status: 'error', error: getErrorMessage(error, 'Request failed') });
      });
  }, [tab, raw, id]);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [menuOpen]);

  const data = detail.status === 'ready' ? detail.data : null;
  const row = data?.row.id ? data.row : listRow;

  const transcript = useMemo(
    () =>
      data
        ? buildTranscript({
            path: data.row.path || listRow?.path || '',
            requestBody: data.client.body,
            responseBody: data.response.body,
            assembled: data.response.assembled,
          })
        : null,
    [data, listRow?.path]
  );

  // Unknown formats fall back to the Request tab.
  const activeTab: DetailTab = tab === 'transcript' && data && !transcript ? 'request' : tab;
  const openRaw = () => onTabChange('raw');

  const handleDelete = () => {
    setMenuOpen(false);
    showConfirmation({
      title: t('proxx.requests.delete_title'),
      message: t('proxx.requests.delete_message'),
      confirmText: t('proxx.requests.delete'),
      variant: 'danger',
      onConfirm: async () => {
        try {
          await proxxRequestsApi.remove(id);
          showNotification(t('proxx.requests.deleted'), 'success');
          onDeleted(id);
        } catch (error) {
          showNotification(
            `${t('proxx.requests.delete_failed')}: ${getErrorMessage(error, '')}`,
            'error'
          );
        }
      },
    });
  };

  const downloadRaw = async () => {
    setMenuOpen(false);
    try {
      const text = raw?.status === 'ready' ? raw.data : await proxxRequestsApi.raw(id);
      const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = row?.file || `${id}.log`;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      showNotification(getErrorMessage(error, t('proxx.requests.raw_failed')), 'error');
    }
  };

  const chain = row ? modelChain(row) : { from: '', to: '' };
  const time = row ? rowTimeMs(row) : null;

  return (
    <aside className={styles.detail} aria-label={t('proxx.requests.detail_label')}>
      <header className={styles.detailHead}>
        <div className={styles.detailTop}>
          {row ? (
            <ProxxBadge tone={statusTone(row)} dot>
              {row.status ?? (row.error ? t('proxx.requests.status_error') : DASH)}
            </ProxxBadge>
          ) : null}
          <div className={styles.detailTitle} title={row ? `${row.method} ${row.path}` : undefined}>
            <span className={styles.detailMethod}>{row?.method || DASH}</span>
            <span className={styles.detailPath}>{row?.path || DASH}</span>
          </div>
          <div className={styles.detailActions}>
            <div className={styles.menuWrap} ref={menuRef}>
              <button
                type="button"
                className={styles.iconBtn}
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                aria-label={t('proxx.requests.more_actions')}
                title={t('proxx.requests.more_actions')}
                onClick={() => setMenuOpen((v) => !v)}
              >
                <IconEllipsis size={15} />
              </button>
              {menuOpen ? (
                <div className={styles.menu} role="menu">
                  <button type="button" role="menuitem" onClick={() => void downloadRaw()}>
                    <IconDownload size={13} />
                    {t('proxx.requests.download_raw')}
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className={styles.menuDanger}
                    onClick={handleDelete}
                  >
                    <IconTrash2 size={13} />
                    {t('proxx.requests.delete')}
                  </button>
                </div>
              ) : null}
            </div>
            <button
              type="button"
              className={styles.iconBtn}
              onClick={onClose}
              aria-label={t('proxx.requests.close')}
              title={`${t('proxx.requests.close')} (Esc)`}
            >
              <IconX size={15} />
            </button>
          </div>
        </div>

        <div className={styles.chain}>
          {chain.from ? (
            <>
              <span className={styles.chainFrom}>{chain.from}</span>
              <span className={styles.chainArrow}>→</span>
            </>
          ) : null}
          <span className={styles.chainTo}>{chain.to || DASH}</span>
          {row?.provider ? <ProxxBadge>{row.provider}</ProxxBadge> : null}
          {row?.stream ? <ProxxBadge tone="accent">{t('proxx.requests.stream')}</ProxxBadge> : null}
          {row && row.attempts > 1 ? (
            <ProxxBadge tone="warning">
              {t('proxx.requests.attempts', { count: row.attempts })}
            </ProxxBadge>
          ) : null}
        </div>

        <dl className={styles.facts}>
          <div>
            <dt>{t('proxx.requests.col.latency')}</dt>
            <dd>{formatLatency(row?.durationMs ?? null)}</dd>
          </div>
          <div>
            <dt>{t('proxx.requests.col.tokens')}</dt>
            <dd>
              {formatCount(row?.inputTokens ?? null)} / {formatCount(row?.outputTokens ?? null)}
              {row?.reasoningTokens ? (
                <span className={styles.factHint}>
                  {' '}
                  +{formatCount(row.reasoningTokens)} {t('proxx.requests.reasoning_short')}
                </span>
              ) : null}
              {row?.cachedTokens ? (
                <span className={styles.factHint}>
                  {' '}
                  · {formatCount(row.cachedTokens)} {t('proxx.requests.cached_short')}
                </span>
              ) : null}
            </dd>
          </div>
          <div>
            <dt>{t('proxx.requests.col.cost')}</dt>
            <dd title={row?.costSource || undefined}>{formatUsd(row?.costUsd ?? null)}</dd>
          </div>
          <div>
            <dt>{t('proxx.requests.col.time')}</dt>
            <dd>{formatAbsolute(time, i18n.language)}</dd>
          </div>
          <div className={styles.factWide}>
            <dt>{t('proxx.requests.id')}</dt>
            <dd className={styles.idRow}>
              <span className={styles.mono}>{id}</span>
              <CopyButton text={id} compact label={t('proxx.requests.copy_id')} />
            </dd>
          </div>
        </dl>

        <div className={styles.tabs} role="tablist" aria-label={t('proxx.requests.detail_label')}>
          {TABS.map((value) => {
            const disabled = value === 'transcript' && !!data && !transcript;
            return (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={activeTab === value}
                disabled={disabled}
                title={disabled ? t('proxx.requests.transcript_unknown') : undefined}
                className={activeTab === value ? `${styles.tab} ${styles.tabActive}` : styles.tab}
                onClick={() => onTabChange(value)}
              >
                {t(`proxx.requests.tab.${value}`)}
                {value === 'upstream' && data && data.attempts.length > 1 ? (
                  <span className={styles.tabCount}>{data.attempts.length}</span>
                ) : null}
              </button>
            );
          })}
        </div>
      </header>

      <div
        className={activeTab === 'raw' ? styles.detailBodyFill : styles.detailBody}
        role="tabpanel"
      >
        {detail.status === 'loading' ? (
          <div className={styles.skeleton} aria-busy="true">
            <i />
            <i />
            <i />
          </div>
        ) : detail.status === 'error' ? (
          <div className={styles.errorNote} role="alert">
            {detail.error}
            <button type="button" className={styles.linkBtn} onClick={() => void load()}>
              {t('proxx.common.retry')}
            </button>
          </div>
        ) : activeTab === 'transcript' && transcript ? (
          <>
            {data!.client.bodyTruncated || data!.response.bodyTruncated ? (
              <TruncatedNotice onOpenRaw={openRaw} />
            ) : null}
            <TranscriptView transcript={transcript} />
          </>
        ) : activeTab === 'request' ? (
          <RequestTab detail={data!} onOpenRaw={openRaw} />
        ) : activeTab === 'upstream' ? (
          <UpstreamTab
            attempts={data!.attempts}
            websocket={data!.apiWebsocketTimeline}
            onOpenRaw={openRaw}
          />
        ) : activeTab === 'response' ? (
          <ResponseTab detail={data!} onOpenRaw={openRaw} />
        ) : raw?.status === 'ready' ? (
          <RawViewer text={raw.data} fileName={row?.file || `${id}.log`} />
        ) : raw?.status === 'error' ? (
          <div className={styles.errorNote} role="alert">
            {raw.error}
            <button type="button" className={styles.linkBtn} onClick={() => setRaw(null)}>
              {t('proxx.common.retry')}
            </button>
          </div>
        ) : (
          <div className={styles.skeleton} aria-busy="true">
            <i />
            <i />
          </div>
        )}
      </div>
      {data && data.rawSizeBytes !== null ? (
        <footer className={styles.detailFoot}>
          {t('proxx.requests.raw_size', { size: formatBytes(data.rawSizeBytes) })}
        </footer>
      ) : null}
    </aside>
  );
}

function RequestTab({ detail, onOpenRaw }: { detail: Detail; onOpenRaw: () => void }) {
  const { t } = useTranslation();
  const { client } = detail;
  const curl = useMemo(
    () =>
      buildCurl({
        method: client.method,
        url: client.url,
        headers: client.headers,
        body: client.body,
      }),
    [client]
  );
  return (
    <div className={styles.stack}>
      <div className={styles.urlLine}>
        <span className={styles.detailMethod}>{client.method || DASH}</span>
        <span className={styles.mono}>{client.url || DASH}</span>
        <span className={styles.spacer} />
        <CopyButton text={curl} label={t('proxx.requests.copy_curl')} />
      </div>
      <Section
        title={t('proxx.requests.headers')}
        defaultOpen={false}
        actions={<span className={styles.cardMeta}>{Object.keys(client.headers).length}</span>}
      >
        <HeadersTable headers={client.headers} />
      </Section>
      <Section title={t('proxx.requests.body')}>
        <BodyView
          text={client.body}
          truncated={client.bodyTruncated}
          onOpenRaw={onOpenRaw}
          copyLabel={t('proxx.requests.copy_body')}
        />
      </Section>
      {detail.websocketTimeline ? (
        <Section title={t('proxx.requests.ws_timeline')} defaultOpen={false}>
          <pre className={styles.pre}>{detail.websocketTimeline}</pre>
        </Section>
      ) : null}
    </div>
  );
}

const attemptTime = (attempt: RequestAttempt) => {
  const ms = Date.parse(attempt.timestamp);
  return Number.isNaN(ms) ? null : ms;
};

function UpstreamTab({
  attempts,
  websocket,
  onOpenRaw,
}: {
  attempts: RequestAttempt[];
  websocket: string;
  onOpenRaw: () => void;
}) {
  const { t, i18n } = useTranslation();
  if (!attempts.length) {
    return (
      <div className={styles.stack}>
        <div className={styles.emptyNote}>{t('proxx.requests.no_attempts')}</div>
        {websocket ? (
          <Section title={t('proxx.requests.ws_timeline')}>
            <pre className={styles.pre}>{websocket}</pre>
          </Section>
        ) : null}
      </div>
    );
  }
  const first = attemptTime(attempts[0]);
  return (
    <div className={styles.stack}>
      {attempts.length > 1 ? (
        <div className={styles.failover}>
          <span className={styles.failoverLabel}>{t('proxx.requests.failover')}</span>
          {attempts.map((attempt, index) => (
            <span key={attempt.index} className={styles.failoverStep}>
              {index > 0 ? <span className={styles.chainArrow}>→</span> : null}
              <ProxxBadge tone={attempt.error ? 'danger' : statusTone4(attempt.status)} dot>
                {attempt.status ?? (attempt.error ? t('proxx.requests.status_error') : DASH)}
              </ProxxBadge>
            </span>
          ))}
        </div>
      ) : null}
      {attempts.map((attempt, index) => {
        const ms = attemptTime(attempt);
        const failed = !!attempt.error || (attempt.status !== null && attempt.status >= 400);
        const last = index === attempts.length - 1;
        return (
          <article
            key={attempt.index}
            className={`${styles.attempt} ${failed ? styles.attemptFailed : last ? styles.attemptOk : ''}`}
          >
            <header className={styles.attemptHead}>
              <span className={styles.attemptIndex}>#{attempt.index}</span>
              <ProxxBadge tone={attempt.error ? 'danger' : statusTone4(attempt.status)} dot>
                {attempt.status ?? (attempt.error ? t('proxx.requests.status_error') : DASH)}
              </ProxxBadge>
              <span className={styles.detailMethod}>{attempt.method || DASH}</span>
              <span className={`${styles.mono} ${styles.attemptUrl}`} title={attempt.url}>
                {attempt.url || DASH}
              </span>
              <span className={styles.spacer} />
              <span className={styles.cardMeta} title={attempt.timestamp || undefined}>
                {ms !== null && first !== null && index > 0
                  ? `+${formatLatency(ms - first)}`
                  : ms !== null
                    ? formatAbsolute(ms, i18n.language)
                    : DASH}
              </span>
            </header>
            {attempt.error ? (
              <pre className={styles.attemptError}>{prettyJson(attempt.error)}</pre>
            ) : null}
            <Section title={t('proxx.requests.upstream_request')} defaultOpen={false}>
              <HeadersTable headers={attempt.headers} />
              <BodyView
                text={attempt.body}
                truncated={attempt.bodyTruncated}
                onOpenRaw={onOpenRaw}
                defaultDepth={1}
              />
            </Section>
            <Section title={t('proxx.requests.upstream_response')} defaultOpen={failed}>
              <HeadersTable headers={attempt.responseHeaders} />
              <BodyView
                text={attempt.responseBody}
                truncated={attempt.responseTruncated}
                onOpenRaw={onOpenRaw}
                defaultDepth={1}
              />
            </Section>
          </article>
        );
      })}
      {websocket ? (
        <Section title={t('proxx.requests.ws_timeline')} defaultOpen={false}>
          <pre className={styles.pre}>{websocket}</pre>
        </Section>
      ) : null}
    </div>
  );
}

function SseEventItem({ event, data }: { event: string; data: string }) {
  const [open, setOpen] = useState(false);
  const preview = data.length > 140 ? `${data.slice(0, 140)}…` : data;
  return (
    <li className={styles.sseItem}>
      <button
        type="button"
        className={styles.sseHead}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className={styles.sseName}>{event || 'message'}</span>
        {!open ? <span className={styles.ssePreview}>{preview}</span> : null}
      </button>
      {open ? <pre className={styles.pre}>{prettyJson(data)}</pre> : null}
    </li>
  );
}

const SSE_PAGE = 300;

function ResponseTab({ detail, onOpenRaw }: { detail: Detail; onOpenRaw: () => void }) {
  const { t } = useTranslation();
  const { response } = detail;
  const [limit, setLimit] = useState(SSE_PAGE);
  const events = response.sseEvents;
  const assembled = response.assembled;
  return (
    <div className={styles.stack}>
      <div className={styles.urlLine}>
        <ProxxBadge tone={statusTone4(response.status)} dot>
          {response.status ?? DASH}
        </ProxxBadge>
        {events ? (
          <span className={styles.cardMeta}>
            {t('proxx.requests.sse_count', { count: events.length })}
          </span>
        ) : null}
      </div>
      <Section
        title={t('proxx.requests.headers')}
        defaultOpen={false}
        actions={<span className={styles.cardMeta}>{Object.keys(response.headers).length}</span>}
      >
        <HeadersTable headers={response.headers} />
      </Section>
      {events ? (
        <div className={styles.streamSplit}>
          <Section title={t('proxx.requests.sse_events')}>
            {response.bodyTruncated ? <TruncatedNotice onOpenRaw={onOpenRaw} /> : null}
            {events.length ? (
              <ol className={styles.sseList}>
                {events.slice(0, limit).map((event, index) => (
                  <SseEventItem key={index} event={event.event} data={event.data} />
                ))}
              </ol>
            ) : (
              <div className={styles.emptyNote}>{t('proxx.requests.no_events')}</div>
            )}
            {events.length > limit ? (
              <button
                type="button"
                className={styles.showMore}
                onClick={() => setLimit((v) => v + SSE_PAGE)}
              >
                {t('proxx.requests.show_more_events', { count: events.length - limit })}
              </button>
            ) : null}
          </Section>
          <Section
            title={t('proxx.requests.assembled')}
            actions={assembled?.text ? <CopyButton text={assembled.text} compact /> : undefined}
          >
            {assembled ? (
              <div className={styles.stack}>
                {assembled.reasoning ? (
                  <div className={styles.reasoningBlock}>
                    <div className={styles.cardMeta}>{t('proxx.requests.reasoning')}</div>
                    <pre className={styles.preWrap}>{assembled.reasoning}</pre>
                  </div>
                ) : null}
                {assembled.text ? <Markdown text={assembled.text} /> : null}
                {assembled.toolCalls.map((call, index) => (
                  <div key={call.id || index} className={styles.toolCard}>
                    <div className={styles.cardHeadStatic}>
                      <span className={styles.toolVerb}>{t('proxx.requests.tool_call')}</span>
                      <span className={styles.mono}>{call.name || DASH}</span>
                      {call.id ? <span className={styles.cardMeta}>{call.id}</span> : null}
                    </div>
                    <div className={styles.cardBody}>
                      <pre className={styles.pre}>{prettyJson(call.arguments) || '{}'}</pre>
                    </div>
                  </div>
                ))}
                {!assembled.text && !assembled.reasoning && !assembled.toolCalls.length ? (
                  <div className={styles.emptyNote}>{t('proxx.requests.empty_body')}</div>
                ) : null}
              </div>
            ) : (
              <div className={styles.emptyNote}>{t('proxx.requests.no_assembled')}</div>
            )}
          </Section>
        </div>
      ) : (
        <Section title={t('proxx.requests.body')}>
          <BodyView
            text={response.body}
            truncated={response.bodyTruncated}
            onOpenRaw={onOpenRaw}
            copyLabel={t('proxx.requests.copy_body')}
          />
        </Section>
      )}
    </div>
  );
}

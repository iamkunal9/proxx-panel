import { useEffect, useRef, useState } from 'react';
import { normalizeRequestRow } from '@/services/api/proxxRequests';
import { useAuthStore } from '@/stores';
import type { RequestRow } from '@/types/proxx';
import { computeApiUrl } from '@/utils/connection';
import { createSseByteParser } from '../logic/sseParser';

export type StreamStatus = 'off' | 'connecting' | 'live' | 'polling';

const MAX_BACKOFF_MS = 30_000;
/** Consecutive stream failures before falling back to polling the list. */
const FAILURES_BEFORE_POLLING = 3;
const POLL_INTERVAL_MS = 3_000;

interface Options {
  enabled: boolean;
  onRows: (rows: RequestRow[]) => void;
  /** Fetches the newest page; used while the stream is unavailable. */
  poll: () => Promise<RequestRow[]>;
}

/**
 * Live tail of new requests over `GET /proxx/requests/stream` (SSE).
 *
 * EventSource cannot send an Authorization header, so this reads the stream with fetch() and the
 * same bearer key the API client uses. It reconnects with exponential backoff; after repeated
 * failures it polls the list every few seconds until the stream comes back.
 */
export function useRequestStream({ enabled, onRows, poll }: Options): StreamStatus {
  const apiBase = useAuthStore((state) => state.apiBase);
  const managementKey = useAuthStore((state) => state.managementKey);
  const connected = useAuthStore((state) => state.connectionStatus === 'connected');
  const [status, setStatus] = useState<StreamStatus>('off');
  const onRowsRef = useRef(onRows);
  const pollRef = useRef(poll);
  useEffect(() => {
    onRowsRef.current = onRows;
    pollRef.current = poll;
  });

  useEffect(() => {
    if (!enabled || !connected || !apiBase) {
      setStatus('off');
      return;
    }
    const controller = new AbortController();
    let failures = 0;
    let stopped = false;
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    const startPolling = () => {
      if (pollTimer || stopped) return;
      setStatus('polling');
      pollTimer = setInterval(() => {
        pollRef
          .current()
          .then((rows) => {
            if (!stopped) onRowsRef.current(rows);
          })
          .catch(() => {
            // Keep polling; the list shows its own errors on manual refresh.
          });
      }, POLL_INTERVAL_MS);
    };

    const stopPolling = () => {
      if (pollTimer) clearInterval(pollTimer);
      pollTimer = null;
    };

    const scheduleRetry = () => {
      if (stopped) return;
      failures += 1;
      if (failures >= FAILURES_BEFORE_POLLING) startPolling();
      else setStatus('connecting');
      const delay = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** Math.min(failures - 1, 5));
      retryTimer = setTimeout(() => void connect(), delay);
    };

    const connect = async () => {
      if (stopped) return;
      try {
        const response = await fetch(`${computeApiUrl(apiBase)}/proxx/requests/stream`, {
          headers: {
            Accept: 'text/event-stream',
            ...(managementKey ? { Authorization: `Bearer ${managementKey}` } : {}),
          },
          cache: 'no-store',
          signal: controller.signal,
        });
        if (response.status === 401) {
          window.dispatchEvent(new Event('unauthorized'));
          stopped = true;
          return;
        }
        if (response.status === 404 || response.status === 501) {
          // No stream on this backend build: poll, and try the stream again much later.
          failures = FAILURES_BEFORE_POLLING;
          startPolling();
          retryTimer = setTimeout(() => void connect(), MAX_BACKOFF_MS * 2);
          return;
        }
        if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);

        failures = 0;
        stopPolling();
        setStatus('live');
        const reader = response.body.getReader();
        const parser = createSseByteParser();
        const dispatch = (messages: ReturnType<typeof parser.push>) => {
          const rows: RequestRow[] = [];
          for (const message of messages) {
            if (message.event !== 'request') continue;
            try {
              const row = normalizeRequestRow(JSON.parse(message.data));
              if (row.id) rows.push(row);
            } catch {
              // Skip malformed events.
            }
          }
          if (rows.length && !stopped) onRowsRef.current(rows);
        };
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          if (value) dispatch(parser.push(value));
        }
        dispatch(parser.end());
        scheduleRetry();
      } catch {
        if (controller.signal.aborted || stopped) return;
        scheduleRetry();
      }
    };

    setStatus('connecting');
    void connect();

    return () => {
      stopped = true;
      controller.abort();
      stopPolling();
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [enabled, connected, apiBase, managementKey]);

  return status;
}

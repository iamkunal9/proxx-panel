/**
 * Shared self-update state. One poller (mounted by `UpdatePill` in the authenticated layout)
 * feeds both the header pill and the Updates page.
 */

import { create } from 'zustand';
import { apiClient } from '@/services/api/client';
import { isUpdateRouteMissing, proxxUpdateApi } from '@/services/api/proxxUpdate';
import type { UpdateStatus } from '@/types/proxx';
import {
  IDLE_TRACKING,
  isTracking,
  reduceApply,
  resultKey,
  type ApplyTracking,
} from './logic/updateLogic';

/** Overridable clock so tests can drive the reconnect window without sleeping. */
export const updateClock = { now: () => Date.now() };

const errorMessage = (error: unknown): string =>
  error instanceof Error && error.message ? error.message : String(error ?? '');

interface UpdateStoreState {
  status: UpdateStatus | null;
  /** The GET answered 404: this proxx predates in-panel updates. */
  backendTooOld: boolean;
  loaded: boolean;
  error: string;
  checking: boolean;
  applying: boolean;
  cancelling: boolean;
  tracking: ApplyTracking;
  /** `resultKey` of the last result the user dismissed, so it is not shown again. */
  dismissedResult: string;
  refresh: () => Promise<void>;
  check: () => Promise<void>;
  /** Rejects with the backend message (e.g. a 409) so the caller can notify. */
  apply: () => Promise<void>;
  cancel: () => Promise<void>;
  dismissResult: () => void;
  reset: () => void;
}

const INITIAL = {
  status: null,
  backendTooOld: false,
  loaded: false,
  error: '',
  checking: false,
  applying: false,
  cancelling: false,
  tracking: IDLE_TRACKING,
  dismissedResult: '',
};

let inflightRefresh: Promise<void> | null = null;

export const useUpdateStore = create<UpdateStoreState>((set, get) => {
  /** Applies a fresh status unless the management connection changed meanwhile. */
  const accept = (revision: number, status: UpdateStatus) => {
    if (revision !== apiClient.getConnectionRevision()) return;
    set((state) => ({
      status,
      backendTooOld: false,
      loaded: true,
      error: '',
      tracking: reduceApply(state.tracking, { type: 'status', status, now: updateClock.now() }),
    }));
  };

  return {
    ...INITIAL,

    refresh() {
      if (inflightRefresh) return inflightRefresh;
      const revision = apiClient.getConnectionRevision();
      inflightRefresh = (async () => {
        try {
          accept(revision, await proxxUpdateApi.getStatus());
        } catch (error) {
          if (revision !== apiClient.getConnectionRevision()) return;
          const { tracking } = get();
          if (isTracking(tracking)) {
            // Expected while proxx restarts: tolerate until the reconnect window runs out.
            set({
              tracking: reduceApply(tracking, { type: 'fetch_failed', now: updateClock.now() }),
            });
          } else if (isUpdateRouteMissing(error)) {
            set({ status: null, backendTooOld: true, loaded: true, error: '' });
          } else {
            set({ loaded: true, error: errorMessage(error) });
          }
        } finally {
          inflightRefresh = null;
        }
      })();
      return inflightRefresh;
    },

    async check() {
      const revision = apiClient.getConnectionRevision();
      set({ checking: true });
      try {
        accept(revision, await proxxUpdateApi.check());
      } finally {
        set({ checking: false });
      }
    },

    async apply() {
      const revision = apiClient.getConnectionRevision();
      set({ applying: true });
      try {
        const status = await proxxUpdateApi.apply();
        if (revision !== apiClient.getConnectionRevision()) return;
        set({
          status,
          tracking: reduceApply(get().tracking, {
            type: 'started',
            status,
            now: updateClock.now(),
          }),
        });
      } finally {
        set({ applying: false });
      }
    },

    async cancel() {
      const revision = apiClient.getConnectionRevision();
      set({ cancelling: true });
      try {
        const status = await proxxUpdateApi.cancel();
        if (revision !== apiClient.getConnectionRevision()) return;
        set({ tracking: IDLE_TRACKING });
        if (status) accept(revision, status);
        else await get().refresh();
      } finally {
        set({ cancelling: false });
      }
    },

    dismissResult() {
      const { tracking, status } = get();
      set({
        tracking: reduceApply(tracking, { type: 'dismiss' }),
        dismissedResult: resultKey(status?.lastResult ?? tracking.result),
      });
    },

    reset() {
      inflightRefresh = null;
      set(INITIAL);
    },
  };
});

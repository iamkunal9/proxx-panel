import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import { IconPencil, IconPlus, IconRefreshCw, IconSearch, IconTrash2 } from '@/components/ui/icons';
import {
  ProxxBadge,
  ProxxError,
  ProxxPage,
  ProxxPageHeader,
  ProxxPanel,
  ProxxUnavailable,
} from '@/components/proxx/ProxxPage';
import ui from '@/components/proxx/ProxxPage.module.scss';
import { IconTag } from '@/components/proxx/icons';
import { DASH, formatClockTime, formatPerMillion } from '@/components/proxx/format';
import { useModelOptions } from '@/components/proxx/useModelOptions';
import { useHeaderRefresh } from '@/hooks/useHeaderRefresh';
import { guardConfigConnection } from '@/services/api/configValue';
import { proxxPricingApi } from '@/services/api/proxxPricing';
import { isProxxUnavailable } from '@/services/api/proxxShared';
import { useAuthStore, useConfigStore, useNotificationStore } from '@/stores';
import type { CatalogPrice, PriceOverride, PricingCatalog } from '@/types/proxx';
import { getErrorMessage } from '@/utils/helpers';
import { PriceEditorModal } from './components/PriceEditorModal';
import { filterCatalog, priceSourceTone } from './logic';
import styles from './PricingPage.module.scss';

const CATALOG_RENDER_LIMIT = 200;

interface EditorState {
  open: boolean;
  initial: PriceOverride | null;
  original: PriceOverride | null;
}

export function PricingPage() {
  const { t, i18n } = useTranslation();
  const connected = useAuthStore((state) => state.connectionStatus === 'connected');
  const apiBase = useAuthStore((state) => state.apiBase);
  const clearConfigCache = useConfigStore((state) => state.clearCache);
  const showNotification = useNotificationStore((state) => state.showNotification);
  const showConfirmation = useNotificationStore((state) => state.showConfirmation);
  const modelOptions = useModelOptions();

  const [catalog, setCatalog] = useState<PricingCatalog | null>(null);
  const [catalogUnavailable, setCatalogUnavailable] = useState(false);
  const [overrides, setOverrides] = useState<PriceOverride[]>([]);
  const [overrideUpstream, setOverrideUpstream] = useState(false);
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query);
  const [editor, setEditor] = useState<EditorState>({ open: false, initial: null, original: null });
  const [saving, setSaving] = useState(false);
  const [togglingUpstream, setTogglingUpstream] = useState(false);
  const requestRef = useRef(0);
  const guardRef = useRef<() => void>(() => {});

  const load = useCallback(async () => {
    if (!connected) return;
    const requestId = ++requestRef.current;
    const guard = guardConfigConnection();
    const [catalogResult, overridesResult, upstreamResult] = await Promise.allSettled([
      proxxPricingApi.getCatalog(),
      proxxPricingApi.getOverrides(),
      proxxPricingApi.getOverrideUpstream(),
    ]);
    if (requestId !== requestRef.current) return;

    if (catalogResult.status === 'fulfilled') {
      setCatalog(catalogResult.value);
      setCatalogUnavailable(false);
    } else {
      setCatalog(null);
      setCatalogUnavailable(isProxxUnavailable(catalogResult.reason));
    }

    if (overridesResult.status === 'rejected') {
      setLoadState('error');
      setError(getErrorMessage(overridesResult.reason, 'Request failed'));
      return;
    }
    guardRef.current = guard;
    setOverrides(overridesResult.value);
    setOverrideUpstream(
      upstreamResult.status === 'fulfilled'
        ? upstreamResult.value
        : (catalogResult.status === 'fulfilled' && catalogResult.value.overrideUpstream) || false
    );
    setLoadState('ready');
    setError('');
  }, [connected]);

  useEffect(() => {
    void load();
  }, [load, apiBase]);

  useEffect(
    () => () => {
      requestRef.current += 1;
    },
    []
  );

  useHeaderRefresh(load, connected);

  const filtered = useMemo(
    () => filterCatalog(catalog?.models ?? [], deferredQuery),
    [catalog, deferredQuery]
  );
  const providerOptions = useMemo(
    () =>
      Array.from(
        new Set((catalog?.models ?? []).map((entry) => entry.provider).filter(Boolean))
      ).sort(),
    [catalog]
  );
  const pickerModels = useMemo(
    () =>
      Array.from(
        new Set([...modelOptions.options, ...(catalog?.models ?? []).map((entry) => entry.model)])
      ).sort((a, b) => a.localeCompare(b)),
    [catalog, modelOptions.options]
  );

  const persist = async (next: PriceOverride[], successKey: string) => {
    setSaving(true);
    try {
      await proxxPricingApi.saveOverrides(next, guardRef.current);
      clearConfigCache();
      setOverrides(next);
      setEditor({ open: false, initial: null, original: null });
      showNotification(t(successKey), 'success');
      void proxxPricingApi
        .getCatalog()
        .then(setCatalog)
        .catch(() => {});
    } catch (saveError) {
      showNotification(
        `${t('proxx.pricing.save_failed')}: ${getErrorMessage(saveError, '')}`,
        'error'
      );
    } finally {
      setSaving(false);
    }
  };

  const handleSave = (entry: PriceOverride) => {
    const next = editor.original
      ? overrides.map((current) => (current === editor.original ? entry : current))
      : [...overrides, entry];
    void persist(next, 'proxx.pricing.saved');
  };

  const handleDelete = (entry: PriceOverride) => {
    showConfirmation({
      title: t('proxx.pricing.delete_title'),
      message: t('proxx.pricing.delete_message', { model: entry.model }),
      confirmText: t('proxx.pricing.delete'),
      variant: 'danger',
      onConfirm: () =>
        persist(
          overrides.filter((current) => current !== entry),
          'proxx.pricing.deleted'
        ),
    });
  };

  const handleToggleUpstream = async (enabled: boolean) => {
    setTogglingUpstream(true);
    try {
      await proxxPricingApi.setOverrideUpstream(enabled, guardRef.current);
      clearConfigCache();
      setOverrideUpstream(enabled);
      showNotification(t('proxx.pricing.saved'), 'success');
    } catch (toggleError) {
      showNotification(
        `${t('proxx.pricing.save_failed')}: ${getErrorMessage(toggleError, '')}`,
        'error'
      );
    } finally {
      setTogglingUpstream(false);
    }
  };

  const openEditor = (initial: PriceOverride | null, original: PriceOverride | null) => {
    void modelOptions.load();
    setEditor({ open: true, initial, original });
  };

  const overrideFromCatalog = (entry: CatalogPrice) => {
    const existing = overrides.find(
      (current) =>
        current.model.toLowerCase() === entry.model.toLowerCase() &&
        current.provider.toLowerCase() === entry.provider.toLowerCase()
    );
    if (existing) {
      openEditor(existing, existing);
      return;
    }
    openEditor(
      {
        model: entry.model,
        provider: entry.provider,
        input: entry.input,
        output: entry.output,
        cacheRead: entry.cacheRead,
        cacheWrite: entry.cacheWrite,
        reasoning: null,
        override: false,
      },
      null
    );
  };

  const catalogMeta = catalog
    ? [
        catalog.catalogSource || t('proxx.pricing.source_unknown'),
        catalog.updatedAt
          ? t('proxx.pricing.updated', { time: formatClockTime(catalog.updatedAt, i18n.language) })
          : null,
        t('proxx.pricing.model_count', { count: catalog.models.length }),
      ]
        .filter(Boolean)
        .join(' · ')
    : '';

  return (
    <ProxxPage>
      <ProxxPageHeader
        icon={<IconTag />}
        title={t('proxx.pricing.title')}
        description={t('proxx.pricing.description')}
        actions={
          <>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void load()}
              aria-label={t('proxx.common.refresh')}
              title={t('proxx.common.refresh')}
            >
              <IconRefreshCw size={14} />
            </Button>
            <Button
              size="sm"
              onClick={() => openEditor(null, null)}
              disabled={loadState !== 'ready'}
            >
              <IconPlus size={14} />
              {t('proxx.pricing.add')}
            </Button>
          </>
        }
      />

      {loadState === 'error' ? <ProxxError message={error} onRetry={() => void load()} /> : null}

      <ProxxPanel>
        <div className={styles.settingRow}>
          <div className={styles.settingCopy}>
            <div className={styles.settingTitle}>{t('proxx.pricing.override_upstream')}</div>
            <p className={styles.settingText}>{t('proxx.pricing.override_upstream_hint')}</p>
          </div>
          <ToggleSwitch
            checked={overrideUpstream}
            onChange={(value) => void handleToggleUpstream(value)}
            disabled={loadState !== 'ready' || togglingUpstream}
            ariaLabel={t('proxx.pricing.override_upstream')}
          />
        </div>
      </ProxxPanel>

      <ProxxPanel
        flush
        title={t('proxx.pricing.overrides_title')}
        meta={t('proxx.pricing.overrides_meta', { count: overrides.length })}
      >
        <div className={ui.tableScroll}>
          <table className={ui.table}>
            <thead>
              <tr>
                <th>{t('proxx.pricing.col.model')}</th>
                <th>{t('proxx.pricing.col.provider')}</th>
                <th className={ui.num}>{t('proxx.pricing.col.input')}</th>
                <th className={ui.num}>{t('proxx.pricing.col.output')}</th>
                <th className={ui.num}>{t('proxx.pricing.col.cacheRead')}</th>
                <th className={ui.num}>{t('proxx.pricing.col.cacheWrite')}</th>
                <th className={ui.num}>{t('proxx.pricing.col.reasoning')}</th>
                <th>{t('proxx.pricing.col.mode')}</th>
                <th className={ui.num}>
                  <span className={styles.srOnly}>{t('proxx.common.actions')}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {overrides.length === 0 ? (
                <tr>
                  <td colSpan={9} className={ui.emptyRow}>
                    {loadState === 'loading'
                      ? t('proxx.common.loading')
                      : t('proxx.pricing.no_overrides')}
                  </td>
                </tr>
              ) : (
                overrides.map((entry) => (
                  <tr key={`${entry.provider}|${entry.model}`}>
                    <td>
                      <span className={`${ui.mono} ${ui.truncate}`} title={entry.model}>
                        {entry.model}
                      </span>
                    </td>
                    <td className={entry.provider ? undefined : ui.muted}>
                      {entry.provider || t('proxx.pricing.any_provider')}
                    </td>
                    <td className={ui.num}>{formatPerMillion(entry.input)}</td>
                    <td className={ui.num}>{formatPerMillion(entry.output)}</td>
                    <td className={ui.num}>{formatPerMillion(entry.cacheRead)}</td>
                    <td className={ui.num}>{formatPerMillion(entry.cacheWrite)}</td>
                    <td className={ui.num}>{formatPerMillion(entry.reasoning)}</td>
                    <td>
                      <ProxxBadge tone={entry.override ? 'accent' : 'neutral'}>
                        {entry.override
                          ? t('proxx.pricing.mode_force')
                          : t('proxx.pricing.mode_fallback')}
                      </ProxxBadge>
                    </td>
                    <td className={ui.num}>
                      <button
                        type="button"
                        className={ui.iconButton}
                        onClick={() => openEditor(entry, entry)}
                        aria-label={t('proxx.pricing.edit_named', { model: entry.model })}
                      >
                        <IconPencil />
                      </button>
                      <button
                        type="button"
                        className={ui.iconButton}
                        onClick={() => handleDelete(entry)}
                        aria-label={t('proxx.pricing.delete_named', { model: entry.model })}
                      >
                        <IconTrash2 />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </ProxxPanel>

      <ProxxPanel
        flush
        title={t('proxx.pricing.catalog_title')}
        meta={catalogMeta}
        actions={
          catalog ? (
            <label className={styles.search}>
              <IconSearch size={14} aria-hidden="true" />
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t('proxx.pricing.search_placeholder')}
                aria-label={t('proxx.pricing.search_placeholder')}
              />
            </label>
          ) : null
        }
      >
        {catalogUnavailable ? (
          <div className={styles.catalogState}>
            <ProxxUnavailable feature={t('proxx.pricing.catalog_title')} compact />
          </div>
        ) : !catalog ? (
          <div className={ui.emptyRow}>
            {loadState === 'loading' ? t('proxx.common.loading') : t('proxx.pricing.no_catalog')}
          </div>
        ) : (
          <>
            <div className={`${ui.tableScroll} ${styles.catalogScroll}`}>
              <table className={ui.table}>
                <thead>
                  <tr>
                    <th>{t('proxx.pricing.col.model')}</th>
                    <th>{t('proxx.pricing.col.provider')}</th>
                    <th className={ui.num}>{t('proxx.pricing.col.input')}</th>
                    <th className={ui.num}>{t('proxx.pricing.col.output')}</th>
                    <th className={ui.num}>{t('proxx.pricing.col.cacheRead')}</th>
                    <th className={ui.num}>{t('proxx.pricing.col.cacheWrite')}</th>
                    <th>{t('proxx.pricing.col.source')}</th>
                    <th className={ui.num}>
                      <span className={styles.srOnly}>{t('proxx.common.actions')}</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.length === 0 ? (
                    <tr>
                      <td colSpan={8} className={ui.emptyRow}>
                        {t('proxx.pricing.no_matches')}
                      </td>
                    </tr>
                  ) : (
                    filtered.slice(0, CATALOG_RENDER_LIMIT).map((entry) => (
                      <tr key={`${entry.provider}|${entry.model}`}>
                        <td>
                          <span className={`${ui.mono} ${ui.truncate}`} title={entry.model}>
                            {entry.model}
                          </span>
                        </td>
                        <td className={entry.provider ? undefined : ui.muted}>
                          {entry.provider || DASH}
                        </td>
                        <td className={ui.num}>{formatPerMillion(entry.input)}</td>
                        <td className={ui.num}>{formatPerMillion(entry.output)}</td>
                        <td className={ui.num}>{formatPerMillion(entry.cacheRead)}</td>
                        <td className={ui.num}>{formatPerMillion(entry.cacheWrite)}</td>
                        <td>
                          <ProxxBadge tone={priceSourceTone(entry.source)}>
                            {entry.source || t('proxx.pricing.source_unknown')}
                          </ProxxBadge>
                        </td>
                        <td className={ui.num}>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => overrideFromCatalog(entry)}
                            aria-label={t('proxx.pricing.override_named', { model: entry.model })}
                          >
                            {t('proxx.pricing.override')}
                          </Button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            {filtered.length > CATALOG_RENDER_LIMIT ? (
              <div className={styles.catalogFooter}>
                {t('proxx.pricing.truncated', {
                  shown: CATALOG_RENDER_LIMIT,
                  total: filtered.length,
                })}
              </div>
            ) : null}
          </>
        )}
      </ProxxPanel>

      <PriceEditorModal
        open={editor.open}
        initial={editor.initial}
        isNew={!editor.original}
        others={overrides.filter((entry) => entry !== editor.original)}
        modelOptions={pickerModels}
        providerOptions={providerOptions}
        saving={saving}
        onClose={() => setEditor({ open: false, initial: null, original: null })}
        onSave={handleSave}
      />
    </ProxxPage>
  );
}

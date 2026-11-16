import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { IconPencil, IconPlus, IconRefreshCw, IconTrash2 } from '@/components/ui/icons';
import {
  ProxxBadge,
  ProxxError,
  ProxxKpi,
  ProxxPage,
  ProxxPageHeader,
  ProxxUnavailable,
  type BadgeTone,
} from '@/components/proxx/ProxxPage';
import ui from '@/components/proxx/ProxxPage.module.scss';
import { IconLayers } from '@/components/proxx/icons';
import { DASH, formatClockTime } from '@/components/proxx/format';
import { useModelOptions } from '@/components/proxx/useModelOptions';
import { useHeaderRefresh } from '@/hooks/useHeaderRefresh';
import { useInterval } from '@/hooks/useInterval';
import { apiClient } from '@/services/api/client';
import { guardConfigConnection } from '@/services/api/configValue';
import { proxxGroupsApi } from '@/services/api/proxxGroups';
import { isProxxUnavailable } from '@/services/api/proxxShared';
import { useAuthStore, useConfigStore, useNotificationStore } from '@/stores';
import type { ModelGroupConfig, ModelGroupMemberStatus, ModelGroupStatus } from '@/types/proxx';
import { getErrorMessage } from '@/utils/helpers';
import { GroupEditorModal } from './components/GroupEditorModal';
import { buildGroupViews } from './logic';
import styles from './ModelGroupsPage.module.scss';

const STATUS_REFRESH_MS = 15_000;

export function ModelGroupsPage() {
  const { t, i18n } = useTranslation();
  const connected = useAuthStore((state) => state.connectionStatus === 'connected');
  const apiBase = useAuthStore((state) => state.apiBase);
  const clearConfigCache = useConfigStore((state) => state.clearCache);
  const showNotification = useNotificationStore((state) => state.showNotification);
  const showConfirmation = useNotificationStore((state) => state.showConfirmation);
  const modelOptions = useModelOptions();

  const [config, setConfig] = useState<ModelGroupConfig[]>([]);
  const [status, setStatus] = useState<ModelGroupStatus[] | null>(null);
  const [statusUnavailable, setStatusUnavailable] = useState(false);
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<{ open: boolean; group: ModelGroupConfig | null }>({
    open: false,
    group: null,
  });
  const [saving, setSaving] = useState(false);
  const requestRef = useRef(0);
  const guardRef = useRef<() => void>(() => {});

  const loadStatus = useCallback(async () => {
    const revision = apiClient.getConnectionRevision();
    try {
      const next = await proxxGroupsApi.getStatus();
      if (revision !== apiClient.getConnectionRevision()) return;
      setStatus(next);
      setStatusUnavailable(false);
    } catch (statusError) {
      if (revision !== apiClient.getConnectionRevision()) return;
      setStatus(null);
      setStatusUnavailable(isProxxUnavailable(statusError));
    }
  }, []);

  const load = useCallback(async () => {
    if (!connected) return;
    const requestId = ++requestRef.current;
    const guard = guardConfigConnection();
    const isCurrent = () => requestId === requestRef.current;
    const [configResult] = await Promise.allSettled([proxxGroupsApi.getConfig(), loadStatus()]);
    if (!isCurrent()) return;
    if (configResult.status === 'rejected') {
      setLoadState('error');
      setError(getErrorMessage(configResult.reason, 'Request failed'));
      return;
    }
    guardRef.current = guard;
    setConfig(configResult.value);
    setLoadState('ready');
    setError('');
  }, [connected, loadStatus]);

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
  useInterval(
    () => void loadStatus(),
    loadState === 'ready' && !statusUnavailable && !editing.open ? STATUS_REFRESH_MS : null
  );

  const views = useMemo(() => buildGroupViews(config, status), [config, status]);
  const memberTotals = useMemo(() => {
    let members = 0;
    let available = 0;
    for (const view of views) {
      for (const member of view.members) {
        members += 1;
        if (member.status?.available) available += 1;
      }
    }
    return { members, available };
  }, [views]);

  const persist = async (next: ModelGroupConfig[], successKey: string) => {
    setSaving(true);
    try {
      await proxxGroupsApi.saveConfig(next, guardRef.current);
      clearConfigCache();
      setConfig(next);
      setEditing({ open: false, group: null });
      showNotification(t(successKey), 'success');
      void loadStatus();
    } catch (saveError) {
      showNotification(
        `${t('proxx.groups.save_failed')}: ${getErrorMessage(saveError, '')}`,
        'error'
      );
    } finally {
      setSaving(false);
    }
  };

  const handleSave = (group: ModelGroupConfig) => {
    const original = editing.group;
    const next = original
      ? config.map((entry) => (entry === original ? group : entry))
      : [...config, group];
    void persist(next, 'proxx.groups.saved');
  };

  const handleDelete = (group: ModelGroupConfig) => {
    showConfirmation({
      title: t('proxx.groups.delete_title'),
      message: t('proxx.groups.delete_message', { name: group.name }),
      confirmText: t('proxx.groups.delete'),
      variant: 'danger',
      onConfirm: () =>
        persist(
          config.filter((entry) => entry !== group),
          'proxx.groups.deleted'
        ),
    });
  };

  const openEditor = (group: ModelGroupConfig | null) => {
    void modelOptions.load();
    setEditing({ open: true, group });
  };

  const memberBadge = (
    member: ModelGroupMemberStatus | null
  ): { tone: BadgeTone; label: string } => {
    if (!member) return { tone: 'neutral', label: t('proxx.groups.member_unknown') };
    if (member.available) return { tone: 'success', label: t('proxx.groups.member_available') };
    if (member.cooldownUntil) {
      return {
        tone: 'warning',
        label: t('proxx.groups.member_cooldown', {
          time: formatClockTime(member.cooldownUntil, i18n.language),
        }),
      };
    }
    return { tone: 'danger', label: t('proxx.groups.member_unavailable') };
  };

  return (
    <ProxxPage>
      <ProxxPageHeader
        icon={<IconLayers />}
        title={t('proxx.groups.title')}
        description={t('proxx.groups.description')}
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
            <Button size="sm" onClick={() => openEditor(null)} disabled={loadState !== 'ready'}>
              <IconPlus size={14} />
              {t('proxx.groups.add')}
            </Button>
          </>
        }
      />

      {loadState === 'error' ? <ProxxError message={error} onRetry={() => void load()} /> : null}
      {statusUnavailable ? (
        <ProxxUnavailable feature={t('proxx.groups.live_feature')} compact />
      ) : null}

      <div className={styles.kpis}>
        <ProxxKpi
          label={t('proxx.groups.kpi_groups')}
          value={loadState === 'loading' ? DASH : views.length}
          hint={t('proxx.groups.kpi_groups_hint', {
            count: views.filter((view) => view.hidden).length,
          })}
          accent="var(--primary-color)"
        />
        <ProxxKpi
          label={t('proxx.groups.kpi_members')}
          value={loadState === 'loading' ? DASH : memberTotals.members}
          accent="var(--text-quaternary)"
        />
        <ProxxKpi
          label={t('proxx.groups.kpi_available')}
          value={status === null ? DASH : `${memberTotals.available}/${memberTotals.members}`}
          hint={
            status === null
              ? t('proxx.groups.member_unknown')
              : t('proxx.groups.kpi_available_hint')
          }
          accent="var(--viz-success)"
        />
      </div>

      {loadState === 'ready' && views.length === 0 ? (
        <div className={styles.empty}>
          <div className={styles.emptyTitle}>{t('proxx.groups.empty_title')}</div>
          <p className={styles.emptyText}>{t('proxx.groups.empty_description')}</p>
          <pre className={styles.emptyCode}>
            {
              'proxx:\n  model-groups:\n    - name: auto\n      models: [gemini-2.5-flash, gpt-5-mini]'
            }
          </pre>
          <Button size="sm" onClick={() => openEditor(null)}>
            <IconPlus size={14} />
            {t('proxx.groups.add')}
          </Button>
        </div>
      ) : null}

      <div className={styles.groups}>
        {views.map((view) => {
          const available = view.members.filter((member) => member.status?.available).length;
          return (
            <section key={view.name} className={styles.group} aria-label={view.name}>
              <header className={styles.groupHeader}>
                <div className={styles.groupTitle}>
                  <span className={`${ui.mono} ${styles.groupName}`}>{view.name}</span>
                  <ProxxBadge tone="accent">
                    {t(`proxx.groups.strategy.${view.strategy}`)}
                  </ProxxBadge>
                  {view.hidden ? <ProxxBadge>{t('proxx.groups.hidden')}</ProxxBadge> : null}
                  {!view.config ? (
                    <ProxxBadge tone="warning">{t('proxx.groups.runtime_only')}</ProxxBadge>
                  ) : null}
                </div>
                <div className={styles.groupActions}>
                  {status !== null ? (
                    <span
                      className={
                        available === 0 && view.members.length > 0
                          ? `${styles.groupHealth} ${styles.groupHealthBad}`
                          : styles.groupHealth
                      }
                    >
                      {t('proxx.groups.health', { available, total: view.members.length })}
                    </span>
                  ) : null}
                  {view.config ? (
                    <>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => openEditor(view.config)}
                        aria-label={t('proxx.groups.edit_title', { name: view.name })}
                      >
                        <IconPencil size={14} />
                        {t('proxx.common.edit')}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDelete(view.config!)}
                        aria-label={t('proxx.groups.delete_title') + ': ' + view.name}
                      >
                        <IconTrash2 size={14} />
                      </Button>
                    </>
                  ) : null}
                </div>
              </header>
              <ol className={styles.members}>
                {view.members.map((member, index) => {
                  const badge = memberBadge(member.status);
                  return (
                    <li key={member.model} className={styles.member}>
                      <span className={styles.memberIndex}>{index + 1}</span>
                      <span className={`${ui.mono} ${styles.memberName}`} title={member.model}>
                        {member.model}
                      </span>
                      <span className={styles.memberProviders}>
                        {member.status?.providers.length
                          ? member.status.providers.map((provider) => (
                              <span key={provider} className={styles.providerChip}>
                                {provider}
                              </span>
                            ))
                          : null}
                      </span>
                      <span className={styles.memberCreds}>
                        {member.status
                          ? t('proxx.groups.credentials', { count: member.status.credentials })
                          : ''}
                      </span>
                      <ProxxBadge tone={badge.tone} dot>
                        {badge.label}
                      </ProxxBadge>
                    </li>
                  );
                })}
              </ol>
            </section>
          );
        })}
      </div>

      <GroupEditorModal
        open={editing.open}
        initial={editing.group}
        others={config.filter((group) => group !== editing.group)}
        modelOptions={modelOptions.options}
        saving={saving}
        onClose={() => setEditing({ open: false, group: null })}
        onSave={handleSave}
      />
    </ProxxPage>
  );
}

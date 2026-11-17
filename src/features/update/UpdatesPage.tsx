import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { ProxxPage, ProxxPageHeader } from '@/components/proxx/ProxxPage';
import { IconUpdate } from '@/components/proxx/icons';
import { useHeaderRefresh } from '@/hooks/useHeaderRefresh';
import { INSTALL_COMMAND } from '@/services/api/proxxUpdate';
import { useConfigStore, useNotificationStore } from '@/stores';
import type { UpdateConfig } from '@/types/proxx';
import { copyToClipboard } from '@/utils/clipboard';
import { getErrorMessage } from '@/utils/helpers';
import { UpdateSettings } from './components/UpdateSettings';
import { UpdateView } from './components/UpdateView';
import { displayVersion } from './logic/updateLogic';
import { saveUpdateSettings } from './updateActions';
import { useUpdateStore } from './useUpdateStore';

export function UpdatesPage() {
  const { t } = useTranslation();
  const store = useUpdateStore();
  const { status, refresh, check, apply, cancel } = store;
  const showNotification = useNotificationStore((state) => state.showNotification);
  const showConfirmation = useNotificationStore((state) => state.showConfirmation);
  const clearConfigCache = useConfigStore((state) => state.clearCache);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void refresh();
  }, [refresh]);
  useHeaderRefresh(refresh);

  const handleCheck = useCallback(async () => {
    try {
      await check();
    } catch (error) {
      showNotification(getErrorMessage(error), 'error');
    }
  }, [check, showNotification]);

  const handleApply = useCallback(() => {
    if (!status) return;
    const target = displayVersion(status.stagedVersion || status.latestVersion);
    showConfirmation({
      title: t('proxx.update.confirm_title', { version: target }),
      message: (
        <div>
          <p>{t('proxx.update.confirm_intro', { version: target })}</p>
          <ul>
            <li>{t('proxx.update.confirm_wait')}</li>
            <li>{t('proxx.update.confirm_restart')}</li>
            <li>{t('proxx.update.confirm_rollback')}</li>
          </ul>
        </div>
      ),
      confirmText: t('proxx.update.update_now'),
      variant: 'primary',
      onConfirm: async () => {
        try {
          await apply();
        } catch (error) {
          showNotification(
            t('proxx.update.apply_rejected', { error: getErrorMessage(error) }),
            'error'
          );
        }
      },
    });
  }, [apply, showConfirmation, showNotification, status, t]);

  const handleCancel = useCallback(async () => {
    try {
      await cancel();
      showNotification(t('proxx.update.cancelled'), 'info');
    } catch (error) {
      showNotification(getErrorMessage(error), 'error');
    }
  }, [cancel, showNotification, t]);

  const handleCopy = useCallback(async () => {
    const ok = await copyToClipboard(INSTALL_COMMAND);
    showNotification(
      t(ok ? 'proxx.update.copied' : 'proxx.update.copy_failed'),
      ok ? 'success' : 'error'
    );
  }, [showNotification, t]);

  const handleSave = useCallback(
    async (next: UpdateConfig) => {
      if (!status) return;
      setSaving(true);
      try {
        await saveUpdateSettings(status.config, next);
        clearConfigCache();
        showNotification(t('proxx.update.settings_saved'), 'success');
      } catch (error) {
        showNotification(getErrorMessage(error), 'error');
      } finally {
        setSaving(false);
        await refresh();
      }
    },
    [clearConfigCache, refresh, showNotification, status, t]
  );

  return (
    <ProxxPage>
      <ProxxPageHeader
        icon={<IconUpdate />}
        title={t('proxx.update.title')}
        description={t('proxx.update.description')}
        actions={
          store.backendTooOld ? undefined : (
            <Button
              variant="secondary"
              size="sm"
              onClick={handleCheck}
              loading={store.checking}
              disabled={!status}
            >
              {t('proxx.update.check_now')}
            </Button>
          )
        }
      />
      <UpdateView
        status={status}
        backendTooOld={store.backendTooOld}
        loaded={store.loaded}
        error={store.error}
        tracking={store.tracking}
        checking={store.checking}
        applying={store.applying}
        cancelling={store.cancelling}
        onApply={handleApply}
        onCancel={handleCancel}
        onDismiss={store.dismissResult}
        dismissedResult={store.dismissedResult}
        onRetry={refresh}
        onCopyInstall={handleCopy}
        settings={
          status ? (
            <UpdateSettings
              key={JSON.stringify(status.config)}
              config={status.config}
              saving={saving}
              onSave={handleSave}
            />
          ) : null
        }
      />
    </ProxxPage>
  );
}

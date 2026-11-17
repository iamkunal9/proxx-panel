import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import { ProxxPanel } from '@/components/proxx/ProxxPage';
import type { UpdateConfig } from '@/types/proxx';
import {
  INTERVAL_MAX_HOURS,
  INTERVAL_MIN_HOURS,
  diffUpdateConfig,
  draftFromConfig,
  validateSettingsDraft,
  type UpdateSettingsDraft,
  type WindowDraft,
} from '../logic/updateLogic';
import styles from './Update.module.scss';

interface UpdateSettingsProps {
  config: UpdateConfig;
  disabled?: boolean;
  saving?: boolean;
  /** Receives the validated config; resolves after the writes finish. */
  onSave: (next: UpdateConfig) => void | Promise<void>;
  /** Initial draft override (tests render invalid drafts with it). */
  initialDraft?: UpdateSettingsDraft;
}

export function UpdateSettings({
  config,
  disabled = false,
  saving = false,
  onSave,
  initialDraft,
}: UpdateSettingsProps) {
  const { t } = useTranslation();
  const ids = useId();
  const [draft, setDraft] = useState<UpdateSettingsDraft>(
    () => initialDraft ?? draftFromConfig(config)
  );
  const validation = validateSettingsDraft(draft);
  const dirty =
    validation.config === null || diffUpdateConfig(config, validation.config).length > 0;
  const patch = (next: Partial<UpdateSettingsDraft>) => setDraft((prev) => ({ ...prev, ...next }));
  const patchWindow = (next: Partial<WindowDraft>) =>
    setDraft((prev) => ({ ...prev, window: { ...prev.window, ...next } }));

  return (
    <ProxxPanel title={t('proxx.update.settings_title')}>
      <form
        className={styles.settings}
        onSubmit={(event) => {
          event.preventDefault();
          if (validation.config) void onSave(validation.config);
        }}
        noValidate
      >
        <div className={styles.settingRow}>
          <div className={styles.settingCopy}>
            <span className={styles.settingLabel}>{t('proxx.update.setting_check')}</span>
            <span className={styles.settingHint}>{t('proxx.update.setting_check_hint')}</span>
          </div>
          <ToggleSwitch
            checked={draft.check}
            onChange={(check) => patch({ check })}
            ariaLabel={t('proxx.update.setting_check')}
            disabled={disabled}
          />
        </div>

        <div className={styles.settingRow}>
          <label className={styles.settingCopy} htmlFor={`${ids}-interval`}>
            <span className={styles.settingLabel}>{t('proxx.update.setting_interval')}</span>
            <span className={styles.settingHint}>
              {t('proxx.update.setting_interval_hint', {
                min: INTERVAL_MIN_HOURS,
                max: INTERVAL_MAX_HOURS,
              })}
            </span>
          </label>
          <div className={styles.fieldStack}>
            <div className={styles.inlineField}>
              <input
                id={`${ids}-interval`}
                className={`input ${styles.numberInput}`}
                type="number"
                inputMode="numeric"
                min={INTERVAL_MIN_HOURS}
                max={INTERVAL_MAX_HOURS}
                step={1}
                value={draft.interval}
                onChange={(event) => patch({ interval: event.target.value })}
                disabled={disabled || !draft.check}
                aria-invalid={validation.intervalError ? true : undefined}
                aria-describedby={validation.intervalError ? `${ids}-interval-error` : undefined}
              />
              <span className={styles.muted}>{t('proxx.update.hours')}</span>
            </div>
            {validation.intervalError ? (
              <span id={`${ids}-interval-error`} className={styles.fieldError} role="alert">
                {t(`proxx.update.${validation.intervalError}`, {
                  min: INTERVAL_MIN_HOURS,
                  max: INTERVAL_MAX_HOURS,
                })}
              </span>
            ) : null}
          </div>
        </div>

        <div className={styles.settingRow}>
          <div className={styles.settingCopy}>
            <span className={styles.settingLabel}>{t('proxx.update.setting_auto_apply')}</span>
            <span className={styles.settingHint}>{t('proxx.update.setting_auto_apply_hint')}</span>
          </div>
          <ToggleSwitch
            checked={draft.autoApply}
            onChange={(autoApply) => patch({ autoApply })}
            ariaLabel={t('proxx.update.setting_auto_apply')}
            disabled={disabled}
          />
        </div>

        <fieldset className={styles.settingRow} disabled={disabled}>
          <div className={styles.settingCopy}>
            <legend className={styles.settingLabel}>{t('proxx.update.setting_window')}</legend>
            <span className={styles.settingHint}>{t('proxx.update.setting_window_hint')}</span>
          </div>
          <div className={styles.fieldStack}>
            <label className={styles.checkLabel}>
              <input
                type="checkbox"
                checked={draft.window.anyTime}
                onChange={(event) =>
                  patchWindow(
                    event.target.checked
                      ? { anyTime: true }
                      : {
                          anyTime: false,
                          start: draft.window.start || '02:00',
                          end: draft.window.end || '05:00',
                        }
                  )
                }
              />
              {t('proxx.update.any_time')}
            </label>
            <div className={styles.inlineField}>
              <input
                className={`input ${styles.timeInput}`}
                type="time"
                aria-label={t('proxx.update.window_start')}
                value={draft.window.start}
                onChange={(event) => patchWindow({ start: event.target.value })}
                disabled={draft.window.anyTime}
                aria-invalid={validation.windowError ? true : undefined}
              />
              <span className={styles.muted}>–</span>
              <input
                className={`input ${styles.timeInput}`}
                type="time"
                aria-label={t('proxx.update.window_end')}
                value={draft.window.end}
                onChange={(event) => patchWindow({ end: event.target.value })}
                disabled={draft.window.anyTime}
                aria-invalid={validation.windowError ? true : undefined}
              />
            </div>
            {validation.windowError ? (
              <span className={styles.fieldError} role="alert">
                {t(`proxx.update.${validation.windowError}`)}
              </span>
            ) : null}
          </div>
        </fieldset>

        <div className={styles.settingsFooter}>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={disabled || saving}
            onClick={() => setDraft(draftFromConfig(config))}
          >
            {t('proxx.update.reset')}
          </Button>
          <Button
            type="submit"
            size="sm"
            disabled={disabled || !dirty || validation.config === null}
            loading={saving}
          >
            {t('proxx.common.save')}
          </Button>
        </div>
      </form>
    </ProxxPanel>
  );
}

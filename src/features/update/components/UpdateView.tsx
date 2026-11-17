/**
 * Presentational Updates page. All state comes in through props so every state can be rendered
 * statically in tests; `UpdatesPage` wires it to the store.
 */

import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import {
  ProxxBadge,
  ProxxError,
  ProxxKpi,
  ProxxPanel,
  type BadgeTone,
} from '@/components/proxx/ProxxPage';
import { DASH } from '@/components/proxx/format';
import { Markdown } from '@/features/requests/components/Markdown';
import { INSTALL_COMMAND, MIN_BACKEND_API } from '@/services/api/proxxUpdate';
import type { UpdateState, UpdateStatus } from '@/types/proxx';
import {
  canApplyUpdate,
  displayVersion,
  formatTimestamp,
  isTerminal,
  isTracking,
  showStepper,
  stepperModel,
  type ApplyTracking,
} from '../logic/updateLogic';
import styles from './Update.module.scss';

export interface UpdateViewProps {
  status: UpdateStatus | null;
  backendTooOld: boolean;
  loaded: boolean;
  error: string;
  tracking: ApplyTracking;
  checking: boolean;
  applying: boolean;
  cancelling: boolean;
  onApply: () => void;
  onCancel: () => void;
  onDismiss: () => void;
  onRetry: () => void;
  onCopyInstall?: () => void;
  /** Rendered below the release notes (the settings form). */
  settings?: ReactNode;
}

const STATE_TONE: Record<UpdateState, BadgeTone> = {
  idle: 'neutral',
  checking: 'accent',
  downloading: 'accent',
  verifying: 'accent',
  staged: 'success',
  waiting_idle: 'warning',
  applying: 'warning',
  failed: 'danger',
};

export function InstallCommand({ onCopy }: { onCopy?: () => void }) {
  const { t } = useTranslation();
  return (
    <div className={styles.install}>
      <code className={styles.installCode}>{INSTALL_COMMAND}</code>
      {onCopy ? (
        <Button variant="secondary" size="sm" onClick={onCopy}>
          {t('proxx.update.copy')}
        </Button>
      ) : null}
    </div>
  );
}

function Notice({
  tone,
  title,
  children,
  action,
}: {
  tone: 'warning' | 'danger' | 'success' | 'info';
  title: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div
      className={`${styles.notice} ${styles[`notice_${tone}`]}`}
      role={tone === 'danger' || tone === 'warning' ? 'alert' : 'status'}
    >
      <div className={styles.noticeBody}>
        <strong className={styles.noticeTitle}>{title}</strong>
        {children ? <div className={styles.noticeText}>{children}</div> : null}
      </div>
      {action ? <div className={styles.noticeAction}>{action}</div> : null}
    </div>
  );
}

function ResultNotice({
  tracking,
  status,
  onDismiss,
}: {
  tracking: ApplyTracking;
  status: UpdateStatus | null;
  onDismiss: () => void;
}) {
  const { t } = useTranslation();
  const dismiss = (
    <Button variant="ghost" size="sm" onClick={onDismiss}>
      {t('proxx.update.dismiss')}
    </Button>
  );
  const target = displayVersion(tracking.result?.to || tracking.targetVersion);
  const from = displayVersion(tracking.fromVersion);
  switch (tracking.phase) {
    case 'success':
      return (
        <Notice
          tone="success"
          title={t('proxx.update.result_success_title', {
            version: displayVersion(status?.currentVersion || tracking.targetVersion),
          })}
          action={dismiss}
        >
          {t('proxx.update.result_success_text')}
        </Notice>
      );
    case 'rolled_back':
      return (
        <Notice
          tone="danger"
          title={t('proxx.update.result_rolled_back_title', { to: target, from })}
          action={dismiss}
        >
          <p>{t('proxx.update.result_rolled_back_text', { from })}</p>
          {tracking.error ? <pre className={styles.errorText}>{tracking.error}</pre> : null}
        </Notice>
      );
    case 'failed':
      return (
        <Notice
          tone="danger"
          title={t('proxx.update.result_failed_title', { to: target })}
          action={dismiss}
        >
          <p>
            {tracking.sawRestart && !tracking.error
              ? t('proxx.update.result_still_old', {
                  version: displayVersion(status?.currentVersion || tracking.fromVersion),
                })
              : t('proxx.update.result_failed_text')}
          </p>
          {tracking.error ? <pre className={styles.errorText}>{tracking.error}</pre> : null}
        </Notice>
      );
    case 'timeout':
      return (
        <Notice tone="danger" title={t('proxx.update.result_timeout_title')} action={dismiss}>
          {t('proxx.update.result_timeout_text')}
        </Notice>
      );
    default:
      return null;
  }
}

function Stepper({ status, tracking }: { status: UpdateStatus | null; tracking: ApplyTracking }) {
  const { t } = useTranslation();
  const steps = stepperModel(status?.state, tracking);
  const restarting = tracking.phase === 'restarting';
  const inflight = status?.inflight ?? tracking.inflight;
  return (
    <ol className={styles.stepper} aria-label={t('proxx.update.progress_title')}>
      {steps.map((step, index) => {
        let hint = '';
        if (step.status === 'active' && step.id === 'waiting_idle') {
          hint = t('proxx.update.inflight', { count: inflight });
        } else if (step.status === 'active' && step.id === 'applying') {
          hint = restarting ? t('proxx.update.restarting_hint') : t('proxx.update.applying_hint');
        }
        return (
          <li
            key={step.id}
            className={`${styles.step} ${styles[`step_${step.status}`]}`}
            aria-current={step.status === 'active' ? 'step' : undefined}
          >
            <span className={styles.stepMarker} aria-hidden="true">
              {step.status === 'done' ? '✓' : step.status === 'error' ? '!' : index + 1}
            </span>
            <span className={styles.stepCopy}>
              <span className={styles.stepLabel}>{t(`proxx.update.step.${step.id}`)}</span>
              {hint ? <span className={styles.stepHint}>{hint}</span> : null}
              <span className={styles.srOnly}>{t(`proxx.update.step_status.${step.status}`)}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

export function UpdateView(props: UpdateViewProps) {
  const {
    status,
    backendTooOld,
    loaded,
    error,
    tracking,
    checking,
    applying,
    cancelling,
    onApply,
    onCancel,
    onDismiss,
    onRetry,
    onCopyInstall,
    settings,
  } = props;
  const { t } = useTranslation();

  if (backendTooOld) {
    return (
      <Notice tone="warning" title={t('proxx.update.old_backend_title')}>
        <p>{t('proxx.update.old_backend_text')}</p>
        <InstallCommand onCopy={onCopyInstall} />
      </Notice>
    );
  }
  if (!status) {
    if (error) return <ProxxError message={error} onRetry={onRetry} />;
    return <div className={styles.loading}>{loaded ? DASH : t('proxx.common.loading')}</div>;
  }

  const apiTooOld = status.apiLevel < MIN_BACKEND_API;
  const canApply = canApplyUpdate(status, tracking);
  const waiting = status.state === 'waiting_idle' && tracking.phase !== 'restarting';
  const targetVersion = status.stagedVersion || status.latestVersion;
  const lastResult = status.lastResult;

  return (
    <div className={styles.stack}>
      {apiTooOld ? (
        <Notice tone="warning" title={t('proxx.update.compat_title')}>
          {t('proxx.update.compat_text', { have: status.apiLevel, need: MIN_BACKEND_API })}
        </Notice>
      ) : null}

      {error ? <ProxxError message={error} onRetry={onRetry} /> : null}

      {isTerminal(tracking) ? (
        <ResultNotice tracking={tracking} status={status} onDismiss={onDismiss} />
      ) : lastResult && lastResult.rolledBack && !isTracking(tracking) ? (
        <Notice
          tone="danger"
          title={t('proxx.update.result_rolled_back_title', {
            to: displayVersion(lastResult.to),
            from: displayVersion(lastResult.from),
          })}
        >
          <p>
            {t('proxx.update.last_result_at', { at: formatTimestamp(lastResult.at) })}{' '}
            {t('proxx.update.result_rolled_back_text', { from: displayVersion(lastResult.from) })}
          </p>
          {lastResult.error ? <pre className={styles.errorText}>{lastResult.error}</pre> : null}
        </Notice>
      ) : null}

      <ProxxPanel
        title={t('proxx.update.version_title')}
        meta={
          <ProxxBadge tone={STATE_TONE[status.state]} dot>
            {t(`proxx.update.state.${status.state}`)}
          </ProxxBadge>
        }
      >
        <div className={styles.kpis}>
          <ProxxKpi
            label={t('proxx.update.current')}
            value={displayVersion(status.currentVersion)}
          />
          <ProxxKpi
            label={t('proxx.update.latest')}
            value={displayVersion(status.latestVersion)}
            hint={
              status.updateAvailable
                ? t('proxx.update.available_hint')
                : status.latestVersion
                  ? t('proxx.update.up_to_date')
                  : undefined
            }
          />
          <ProxxKpi
            label={t('proxx.update.checked_at')}
            value={<span className={styles.smallValue}>{formatTimestamp(status.checkedAt)}</span>}
            hint={checking || status.state === 'checking' ? t('proxx.update.checking') : undefined}
          />
        </div>

        {status.lastCheckError ? (
          <p className={styles.inlineError} role="alert">
            {t('proxx.update.check_error', { error: status.lastCheckError })}
          </p>
        ) : null}

        {!status.supported ? (
          <Notice tone="warning" title={t('proxx.update.unsupported_title')}>
            <p>{status.unsupportedReason || t('proxx.update.unsupported_default')}</p>
            <p>{t('proxx.update.unsupported_howto')}</p>
            <InstallCommand onCopy={onCopyInstall} />
          </Notice>
        ) : null}

        <div className={styles.actions}>
          <Button onClick={onApply} disabled={!canApply} loading={applying}>
            {status.stagedVersion && !status.updateAvailable
              ? t('proxx.update.apply_staged', { version: displayVersion(status.stagedVersion) })
              : t('proxx.update.update_now')}
          </Button>
          {status.releaseUrl ? (
            <a
              className={styles.releaseLink}
              href={status.releaseUrl}
              target="_blank"
              rel="noopener noreferrer nofollow"
            >
              {t('proxx.update.view_release')}
            </a>
          ) : null}
          {lastResult && !lastResult.rolledBack ? (
            <span className={styles.muted}>
              {t(lastResult.ok ? 'proxx.update.last_ok' : 'proxx.update.last_failed', {
                from: displayVersion(lastResult.from),
                to: displayVersion(lastResult.to),
                at: formatTimestamp(lastResult.at),
              })}
            </span>
          ) : null}
        </div>
      </ProxxPanel>

      {showStepper(status.state, tracking) ? (
        <ProxxPanel
          title={t('proxx.update.progress_title')}
          meta={targetVersion ? displayVersion(tracking.targetVersion || targetVersion) : undefined}
          actions={
            waiting ? (
              <Button variant="secondary" size="sm" onClick={onCancel} loading={cancelling}>
                {t('proxx.update.cancel')}
              </Button>
            ) : undefined
          }
        >
          <Stepper status={status} tracking={tracking} />
          {waiting ? <p className={styles.muted}>{t('proxx.update.waiting_explain')}</p> : null}
        </ProxxPanel>
      ) : null}

      <ProxxPanel
        title={t('proxx.update.notes_title')}
        meta={status.latestVersion ? displayVersion(status.latestVersion) : undefined}
      >
        {status.releaseNotes.trim() ? (
          <div className={styles.notes}>
            <Markdown text={status.releaseNotes} />
          </div>
        ) : (
          <p className={styles.muted}>{t('proxx.update.notes_empty')}</p>
        )}
      </ProxxPanel>

      {settings}
    </div>
  );
}

import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { IconUpdate } from '@/components/proxx/icons';
import { displayVersion, isInProgress, isTracking } from '../logic/updateLogic';
import { useUpdatePoller } from '../useUpdatePoller';
import { useUpdateStore } from '../useUpdateStore';
import styles from './UpdatePill.module.scss';

export const UPDATES_PATH = '/updates';

/** Header pill: "Update available: vX → vY" (or "Updating…"). Also owns the shared poller. */
export function UpdatePill() {
  useUpdatePoller();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const status = useUpdateStore((state) => state.status);
  const tracking = useUpdateStore((state) => state.tracking);

  if (!status) return null;
  const updating =
    isTracking(tracking) || (isInProgress(status.state) && status.state !== 'checking');
  if (!updating && !status.updateAvailable) return null;

  const label = updating
    ? t('proxx.update.pill_updating')
    : t('proxx.update.pill_available', {
        from: displayVersion(status.currentVersion),
        to: displayVersion(status.latestVersion),
      });

  return (
    <button
      type="button"
      className={updating ? `${styles.pill} ${styles.pillBusy}` : styles.pill}
      onClick={() => navigate(UPDATES_PATH)}
      title={label}
    >
      <IconUpdate size={14} />
      <span className={styles.label}>{label}</span>
    </button>
  );
}

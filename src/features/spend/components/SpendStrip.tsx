/**
 * Headline spend numbers for the dashboard (last 7 days). Renders nothing on a backend without
 * the proxx usage endpoints, so the upstream dashboard is unchanged there.
 */

import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { formatTokens, formatUsd } from '@/components/proxx/format';
import { IconSpend } from '@/components/proxx/icons';
import { usageFailureRate } from '@/services/api/proxxUsage';
import { useSpendData } from '../hooks/useSpendData';
import styles from './SpendStrip.module.scss';

export function SpendStrip() {
  const { t } = useTranslation();
  const { status, daily, series } = useSpendData({ preset: '7d' });
  if (status !== 'ready' || !daily) return null;

  const totals = daily.totals;
  const today = series.length ? series[series.length - 1] : null;
  const peak = Math.max(1e-9, ...series.map((row) => row.costUsd));
  const items = [
    { label: t('proxx.spend.kpi_cost'), value: formatUsd(totals.costUsd) },
    { label: t('proxx.dashboard.today'), value: formatUsd(today?.costUsd ?? 0) },
    { label: t('proxx.spend.kpi_requests'), value: totals.requests.toLocaleString() },
    {
      label: t('proxx.spend.kpi_tokens'),
      value: formatTokens(totals.inputTokens + totals.outputTokens),
    },
    {
      label: t('proxx.spend.kpi_failure_rate'),
      value: `${usageFailureRate(totals).toFixed(1)}%`,
    },
  ];

  return (
    <section className={styles.strip} aria-label={t('proxx.dashboard.spend_label')}>
      <div className={styles.head}>
        <span className={styles.icon} aria-hidden="true">
          <IconSpend size={14} />
        </span>
        <span className={styles.title}>{t('proxx.dashboard.spend_title')}</span>
        <Link to="/spend" className={styles.link}>
          {t('proxx.dashboard.open_spend')} →
        </Link>
      </div>
      <div className={styles.body}>
        <dl className={styles.items}>
          {items.map((item) => (
            <div key={item.label} className={styles.item}>
              <dt>{item.label}</dt>
              <dd>{item.value}</dd>
            </div>
          ))}
        </dl>
        <div className={styles.spark} aria-hidden="true">
          {series.map((row) => (
            <span
              key={row.key}
              className={styles.sparkBar}
              style={{ height: `${Math.max(4, (row.costUsd / peak) * 100)}%` }}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

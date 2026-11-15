import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { IconRefreshCw, IconTrash2 } from '@/components/ui/icons';
import {
  ProxxBadge,
  ProxxError,
  ProxxKpi,
  ProxxPage,
  ProxxPageHeader,
  ProxxPanel,
  ProxxSegmented,
  ProxxUnavailable,
} from '@/components/proxx/ProxxPage';
import ui from '@/components/proxx/ProxxPage.module.scss';
import { IconSpend } from '@/components/proxx/icons';
import {
  DASH,
  formatClockTime,
  formatLatency,
  formatTokens,
  formatUsd,
} from '@/components/proxx/format';
import { useHeaderRefresh } from '@/hooks/useHeaderRefresh';
import { useInterval } from '@/hooks/useInterval';
import {
  proxxUsageApi,
  USAGE_RANGE_PRESETS,
  usageFailureRate,
  type UsageRangePreset,
} from '@/services/api/proxxUsage';
import { useNotificationStore } from '@/stores';
import type { UsageGroupBy, UsageRow } from '@/types/proxx';
import { getErrorMessage } from '@/utils/helpers';
import { useSpendData } from './hooks/useSpendData';
import { costSourceTone, displayApiKey } from './logic';
import { UsageChart, type UsageMetric } from './components/UsageChart';
import styles from './SpendPage.module.scss';

type Breakdown = Exclude<UsageGroupBy, 'day'>;

const BREAKDOWNS: Breakdown[] = ['model', 'provider', 'api_key'];
const METRICS: UsageMetric[] = ['cost', 'requests', 'tokens'];
const RECENT_LIMIT = 50;
const AUTO_REFRESH_MS = 30_000;

export function SpendPage() {
  const { t, i18n } = useTranslation();
  const showNotification = useNotificationStore((state) => state.showNotification);
  const showConfirmation = useNotificationStore((state) => state.showConfirmation);
  const [preset, setPreset] = useState<UsageRangePreset>('7d');
  const [breakdown, setBreakdown] = useState<Breakdown>('model');
  const [metric, setMetric] = useState<UsageMetric>('cost');

  const data = useSpendData({ preset, groupBy: breakdown, recentLimit: RECENT_LIMIT });
  const { refresh, status } = data;

  useHeaderRefresh(refresh, status !== 'unavailable');
  useInterval(() => void refresh(), status === 'ready' ? AUTO_REFRESH_MS : null);

  const totals = data.daily?.totals;
  const failureRate = totals ? usageFailureRate(totals) : 0;

  const handleReset = useCallback(() => {
    showConfirmation({
      title: t('proxx.spend.reset_title'),
      message: t('proxx.spend.reset_message'),
      confirmText: t('proxx.spend.reset_confirm'),
      variant: 'danger',
      onConfirm: async () => {
        try {
          await proxxUsageApi.reset();
          showNotification(t('proxx.spend.reset_done'), 'success');
          await refresh();
        } catch (error) {
          showNotification(
            `${t('proxx.spend.reset_failed')}: ${getErrorMessage(error, '')}`,
            'error'
          );
        }
      },
    });
  }, [refresh, showConfirmation, showNotification, t]);

  const breakdownRows = useMemo(() => {
    const rows = data.breakdown?.rows ?? [];
    return rows
      .slice()
      .sort((a, b) => b.costUsd - a.costUsd || b.requests - a.requests)
      .slice(0, 100);
  }, [data.breakdown]);
  const breakdownCostTotal = breakdownRows.reduce((sum, row) => sum + row.costUsd, 0);
  const breakdownRequestTotal = breakdownRows.reduce((sum, row) => sum + row.requests, 0);

  const loading = status === 'loading';
  const value = (render: () => string) => (loading || !totals ? DASH : render());

  const presetOptions = USAGE_RANGE_PRESETS.map((option) => ({
    value: option,
    label: t(`proxx.spend.range.${option}`),
  }));

  return (
    <ProxxPage>
      <ProxxPageHeader
        icon={<IconSpend />}
        title={t('proxx.spend.title')}
        description={t('proxx.spend.description')}
        actions={
          <>
            <ProxxSegmented
              value={preset}
              options={presetOptions}
              onChange={setPreset}
              ariaLabel={t('proxx.spend.range_label')}
            />
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void refresh()}
              loading={data.refreshing && status === 'ready'}
              aria-label={t('proxx.common.refresh')}
              title={t('proxx.common.refresh')}
            >
              <IconRefreshCw size={14} />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleReset}
              disabled={status !== 'ready'}
              title={t('proxx.spend.reset')}
            >
              <IconTrash2 size={14} />
              {t('proxx.spend.reset')}
            </Button>
          </>
        }
      />

      {status === 'unavailable' ? (
        <ProxxUnavailable feature={t('proxx.spend.title')} />
      ) : (
        <>
          {status === 'error' ? (
            <ProxxError message={data.error} onRetry={() => void refresh()} />
          ) : null}

          <div className={styles.kpis}>
            <ProxxKpi
              label={t('proxx.spend.kpi_cost')}
              accent="var(--primary-color)"
              loading={loading}
              value={value(() => formatUsd(totals!.costUsd))}
              hint={
                totals && totals.unknownCostRequests > 0
                  ? t('proxx.spend.kpi_cost_unknown', { count: totals.unknownCostRequests })
                  : t(`proxx.spend.range_hint.${preset}`)
              }
            />
            <ProxxKpi
              label={t('proxx.spend.kpi_requests')}
              accent="var(--viz-success)"
              loading={loading}
              value={value(() => totals!.requests.toLocaleString())}
              hint={
                totals && totals.requests > 0
                  ? t('proxx.spend.kpi_requests_hint', {
                      cost: formatUsd(totals.costUsd / totals.requests),
                    })
                  : t('proxx.spend.no_requests')
              }
            />
            <ProxxKpi
              label={t('proxx.spend.kpi_tokens')}
              accent="var(--amber-color)"
              loading={loading}
              value={value(() => formatTokens(totals!.inputTokens + totals!.outputTokens))}
              hint={
                totals
                  ? t('proxx.spend.kpi_tokens_hint', {
                      input: formatTokens(totals.inputTokens),
                      output: formatTokens(totals.outputTokens),
                      cached: formatTokens(totals.cachedTokens),
                    })
                  : undefined
              }
            />
            <ProxxKpi
              label={t('proxx.spend.kpi_failure_rate')}
              accent={failureRate > 5 ? 'var(--viz-failure)' : 'var(--text-quaternary)'}
              loading={loading}
              value={value(() => `${failureRate.toFixed(failureRate < 10 ? 1 : 0)}%`)}
              hint={
                totals ? t('proxx.spend.kpi_failures_hint', { count: totals.failures }) : undefined
              }
            />
          </div>

          <ProxxPanel
            title={t('proxx.spend.chart_title')}
            meta={
              data.range.from === data.range.to
                ? data.range.from
                : `${data.range.from} → ${data.range.to}`
            }
            actions={
              <ProxxSegmented
                value={metric}
                options={METRICS.map((option) => ({
                  value: option,
                  label: t(`proxx.spend.metric.${option}`),
                }))}
                onChange={setMetric}
                ariaLabel={t('proxx.spend.metric_label')}
              />
            }
          >
            {data.series.length ? (
              <UsageChart series={data.series} metric={metric} />
            ) : (
              <div className={styles.chartPlaceholder}>
                {loading ? t('proxx.common.loading') : t('proxx.spend.no_requests')}
              </div>
            )}
          </ProxxPanel>

          <ProxxPanel
            flush
            title={t('proxx.spend.breakdown_title')}
            meta={t('proxx.spend.rows', { count: breakdownRows.length })}
            actions={
              <ProxxSegmented
                value={breakdown}
                options={BREAKDOWNS.map((option) => ({
                  value: option,
                  label: t(`proxx.spend.by.${option}`),
                }))}
                onChange={setBreakdown}
                ariaLabel={t('proxx.spend.breakdown_label')}
              />
            }
          >
            <BreakdownTable
              rows={breakdownRows}
              dimension={breakdown}
              costTotal={breakdownCostTotal}
              requestTotal={breakdownRequestTotal}
              loading={loading}
            />
          </ProxxPanel>

          <ProxxPanel
            flush
            title={t('proxx.spend.recent_title')}
            meta={t('proxx.spend.recent_meta', { count: data.recent.length })}
          >
            <div className={ui.tableScroll}>
              <table className={ui.table}>
                <thead>
                  <tr>
                    <th>{t('proxx.spend.col.time')}</th>
                    <th>{t('proxx.spend.col.model')}</th>
                    <th>{t('proxx.spend.col.provider')}</th>
                    <th>{t('proxx.spend.col.api_key')}</th>
                    <th>{t('proxx.spend.col.status')}</th>
                    <th className={ui.num}>{t('proxx.spend.col.latency')}</th>
                    <th className={ui.num}>{t('proxx.spend.col.tokens')}</th>
                    <th className={ui.num}>{t('proxx.spend.col.cost')}</th>
                    <th>{t('proxx.spend.col.source')}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.recent.length === 0 ? (
                    <tr>
                      <td colSpan={9} className={ui.emptyRow}>
                        {loading ? t('proxx.common.loading') : t('proxx.spend.no_recent')}
                      </td>
                    </tr>
                  ) : (
                    data.recent.map((item, index) => (
                      <tr key={`${item.timestamp}-${index}`}>
                        <td className={ui.muted}>
                          {formatClockTime(item.timestamp, i18n.language)}
                        </td>
                        <td>
                          <span className={`${ui.mono} ${ui.truncate}`} title={item.model}>
                            {item.alias && item.alias !== item.model ? (
                              <>
                                {item.alias}
                                <span className={ui.muted}> → {item.model}</span>
                              </>
                            ) : (
                              item.model || DASH
                            )}
                          </span>
                        </td>
                        <td>{item.provider || DASH}</td>
                        <td className={`${ui.mono} ${ui.muted}`}>
                          {displayApiKey(item.apiKey) || DASH}
                        </td>
                        <td>
                          <ProxxBadge tone={item.failed ? 'danger' : 'success'} dot>
                            {item.statusCode ?? (item.failed ? t('proxx.spend.failed') : 'OK')}
                          </ProxxBadge>
                          {item.stream ? (
                            <span className={styles.streamTag}>{t('proxx.spend.stream')}</span>
                          ) : null}
                        </td>
                        <td className={ui.num}>{formatLatency(item.latencyMs)}</td>
                        <td className={ui.num}>
                          {formatTokens(item.inputTokens)}
                          <span className={ui.muted}> / {formatTokens(item.outputTokens)}</span>
                        </td>
                        <td className={ui.num}>
                          {item.costUsd === null ? (
                            <span className={ui.muted} title={t('proxx.spend.cost_unknown')}>
                              {DASH}
                            </span>
                          ) : (
                            formatUsd(item.costUsd)
                          )}
                        </td>
                        <td>
                          <ProxxBadge tone={costSourceTone(item.costSource)}>
                            {item.costSource || t('proxx.spend.source_unknown')}
                          </ProxxBadge>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </ProxxPanel>
        </>
      )}
    </ProxxPage>
  );
}

interface BreakdownTableProps {
  rows: UsageRow[];
  dimension: Breakdown;
  costTotal: number;
  requestTotal: number;
  loading: boolean;
}

function BreakdownTable({
  rows,
  dimension,
  costTotal,
  requestTotal,
  loading,
}: BreakdownTableProps) {
  const { t } = useTranslation();
  const shareOf = (row: UsageRow) =>
    costTotal > 0
      ? (row.costUsd / costTotal) * 100
      : requestTotal > 0
        ? (row.requests / requestTotal) * 100
        : 0;

  return (
    <div className={ui.tableScroll}>
      <table className={ui.table}>
        <thead>
          <tr>
            <th>{t(`proxx.spend.by.${dimension}`)}</th>
            <th className={ui.num}>{t('proxx.spend.col.requests')}</th>
            <th className={ui.num}>{t('proxx.spend.col.failures')}</th>
            <th className={ui.num}>{t('proxx.spend.col.input')}</th>
            <th className={ui.num}>{t('proxx.spend.col.output')}</th>
            <th className={ui.num}>{t('proxx.spend.col.cost')}</th>
            <th className={styles.shareHead}>{t('proxx.spend.col.share')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={7} className={ui.emptyRow}>
                {loading ? t('proxx.common.loading') : t('proxx.spend.no_requests')}
              </td>
            </tr>
          ) : (
            rows.map((row) => {
              const share = shareOf(row);
              const label =
                dimension === 'api_key'
                  ? displayApiKey(row.key)
                  : row.key || t('proxx.spend.unknown_key');
              return (
                <tr key={row.key}>
                  <td>
                    <span
                      className={`${dimension === 'provider' ? '' : ui.mono} ${ui.truncate}`}
                      title={row.key}
                    >
                      {label || DASH}
                    </span>
                  </td>
                  <td className={ui.num}>{row.requests.toLocaleString()}</td>
                  <td className={`${ui.num} ${row.failures ? styles.failText : ui.muted}`}>
                    {row.failures.toLocaleString()}
                  </td>
                  <td className={ui.num}>{formatTokens(row.inputTokens)}</td>
                  <td className={ui.num}>{formatTokens(row.outputTokens)}</td>
                  <td className={ui.num}>
                    {formatUsd(row.costUsd)}
                    {row.unknownCostRequests > 0 ? (
                      <span
                        className={styles.unknownMark}
                        title={t('proxx.spend.kpi_cost_unknown', {
                          count: row.unknownCostRequests,
                        })}
                      >
                        *
                      </span>
                    ) : null}
                  </td>
                  <td className={styles.shareCell}>
                    <div className={styles.shareInner}>
                      <div className={styles.shareTrack} aria-hidden="true">
                        <div
                          className={styles.shareFill}
                          style={{ width: `${Math.min(100, share)}%` }}
                        />
                      </div>
                      <span className={styles.shareValue}>
                        {share.toFixed(share < 10 ? 1 : 0)}%
                      </span>
                    </div>
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}

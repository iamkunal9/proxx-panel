/**
 * Daily usage bar chart, hand-written SVG (no chart library in the single-file build).
 * Keyboard: focus the chart and use ←/→ (Home/End) to move between days.
 */

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { UsageRow } from '@/types/proxx';
import { formatDayLabel, formatTokens, formatUsd } from '@/components/proxx/format';
import { metricValue, niceAxisMax, type UsageMetric } from '../logic';
import styles from './UsageChart.module.scss';

export type { UsageMetric };

const HEIGHT = 220;
const PAD = { top: 14, right: 8, bottom: 26, left: 56 };

const formatAxis = (value: number, metric: UsageMetric): string =>
  metric === 'cost' ? formatUsd(value, { compact: true }) : formatTokens(value);

interface UsageChartProps {
  series: UsageRow[];
  metric: UsageMetric;
}

export function UsageChart({ series, metric }: UsageChartProps) {
  const { t, i18n } = useTranslation();
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(720);
  const [active, setActive] = useState<number | null>(null);

  useEffect(() => {
    const element = wrapRef.current;
    if (!element || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => {
      const next = Math.round(entry.contentRect.width);
      if (next > 0) setWidth(next);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const values = useMemo(() => series.map((row) => metricValue(row, metric)), [series, metric]);
  const max = niceAxisMax(Math.max(0, ...values));
  const innerWidth = Math.max(40, width - PAD.left - PAD.right);
  const innerHeight = HEIGHT - PAD.top - PAD.bottom;
  const band = series.length ? innerWidth / series.length : innerWidth;
  const barWidth = Math.max(2, Math.min(28, band * 0.64));
  const labelEvery = Math.max(1, Math.ceil(series.length / Math.max(1, innerWidth / 64)));
  const ticks = [0, 0.5, 1].map((ratio) => ratio * max);

  const scaleY = (value: number) => PAD.top + innerHeight - (value / max) * innerHeight;

  const metricLabel = t(`proxx.spend.metric.${metric}`);
  const formatValue = (value: number) =>
    metric === 'cost' ? formatUsd(value) : Math.round(value).toLocaleString();

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!series.length) return;
    const last = series.length - 1;
    const current = active ?? last;
    let next: number | null = null;
    if (event.key === 'ArrowLeft') next = Math.max(0, current - 1);
    if (event.key === 'ArrowRight') next = Math.min(last, current + 1);
    if (event.key === 'Home') next = 0;
    if (event.key === 'End') next = last;
    if (event.key === 'Escape') {
      setActive(null);
      return;
    }
    if (next !== null) {
      event.preventDefault();
      setActive(next);
    }
  };

  const activeRow = active !== null ? series[active] : null;
  const tooltipLeft =
    active !== null ? Math.min(Math.max(PAD.left + band * (active + 0.5), 90), width - 90) : 0;
  const total = values.reduce((sum, value) => sum + value, 0);

  return (
    <div
      className={styles.wrap}
      ref={wrapRef}
      tabIndex={0}
      role="group"
      aria-roledescription={t('proxx.spend.chart_role')}
      aria-label={t('proxx.spend.chart_label', {
        metric: metricLabel,
        days: series.length,
        total: formatValue(total),
      })}
      onKeyDown={handleKeyDown}
      onBlur={() => setActive(null)}
      onMouseLeave={() => setActive(null)}
    >
      <svg width={width} height={HEIGHT} className={styles.svg} aria-hidden="true">
        {ticks.map((tick) => (
          <g key={tick}>
            <line
              x1={PAD.left}
              x2={width - PAD.right}
              y1={scaleY(tick)}
              y2={scaleY(tick)}
              className={tick === 0 ? styles.baseline : styles.grid}
            />
            <text x={PAD.left - 10} y={scaleY(tick)} className={styles.axisLabel} textAnchor="end">
              {formatAxis(tick, metric)}
            </text>
          </g>
        ))}

        {series.map((row, index) => {
          const value = values[index];
          const x = PAD.left + band * index + (band - barWidth) / 2;
          const y = scaleY(value);
          const barHeight = Math.max(value > 0 ? 2 : 0, PAD.top + innerHeight - y);
          const isActive = index === active;
          return (
            <g key={row.key}>
              <rect
                x={PAD.left + band * index}
                y={PAD.top}
                width={band}
                height={innerHeight}
                className={isActive ? styles.hoverBand : styles.hitBand}
                onMouseEnter={() => setActive(index)}
              />
              {barHeight > 0 ? (
                <rect
                  x={x}
                  y={PAD.top + innerHeight - barHeight}
                  width={barWidth}
                  height={barHeight}
                  rx={Math.min(3, barWidth / 3)}
                  className={isActive ? `${styles.bar} ${styles.barActive}` : styles.bar}
                  pointerEvents="none"
                />
              ) : null}
              {index % labelEvery === 0 || index === series.length - 1 ? (
                <text
                  x={PAD.left + band * (index + 0.5)}
                  y={HEIGHT - 8}
                  className={styles.axisLabel}
                  textAnchor="middle"
                >
                  {formatDayLabel(row.key, i18n.language)}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>

      <div className={styles.srOnly} aria-live="polite">
        {activeRow
          ? `${formatDayLabel(activeRow.key, i18n.language)}: ${formatValue(values[active ?? 0])}`
          : ''}
      </div>

      {activeRow ? (
        <div className={styles.tooltip} style={{ left: tooltipLeft }} aria-hidden="true">
          <div className={styles.tooltipDate}>{formatDayLabel(activeRow.key, i18n.language)}</div>
          <div className={styles.tooltipRow}>
            <span>{t('proxx.spend.metric.cost')}</span>
            <b>{formatUsd(activeRow.costUsd)}</b>
          </div>
          <div className={styles.tooltipRow}>
            <span>{t('proxx.spend.metric.requests')}</span>
            <b>{activeRow.requests.toLocaleString()}</b>
          </div>
          <div className={styles.tooltipRow}>
            <span>{t('proxx.spend.metric.tokens')}</span>
            <b>{formatTokens(activeRow.inputTokens + activeRow.outputTokens)}</b>
          </div>
          {activeRow.failures > 0 ? (
            <div className={styles.tooltipRow}>
              <span>{t('proxx.spend.failures')}</span>
              <b className={styles.tooltipDanger}>{activeRow.failures.toLocaleString()}</b>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

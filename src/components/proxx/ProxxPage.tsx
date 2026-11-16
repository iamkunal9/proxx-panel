/**
 * Layout primitives shared by the proxx pages. They only compose the theme tokens, so they follow
 * light/dark like every upstream page.
 */

import { useId, type KeyboardEvent, type PropsWithChildren, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { IconSatellite } from '@/components/ui/icons';
import styles from './ProxxPage.module.scss';

export function ProxxPage({ children }: PropsWithChildren) {
  return <div className={styles.page}>{children}</div>;
}

interface PageHeaderProps {
  icon?: ReactNode;
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}

export function ProxxPageHeader({ icon, title, description, actions }: PageHeaderProps) {
  return (
    <header className={styles.header}>
      <div className={styles.headerCopy}>
        <h1 className={styles.title}>
          {icon ? (
            <span className={styles.titleIcon} aria-hidden="true">
              {icon}
            </span>
          ) : null}
          {title}
        </h1>
        {description ? <p className={styles.description}>{description}</p> : null}
      </div>
      {actions ? <div className={styles.headerActions}>{actions}</div> : null}
    </header>
  );
}

interface PanelProps {
  title?: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
  flush?: boolean;
  className?: string;
}

export function ProxxPanel({
  title,
  meta,
  actions,
  flush = false,
  className,
  children,
}: PropsWithChildren<PanelProps>) {
  return (
    <section className={[styles.panel, className].filter(Boolean).join(' ')}>
      {title || actions ? (
        <div className={styles.panelHeader}>
          <div className={styles.panelHeading}>
            {title ? <h2 className={styles.panelTitle}>{title}</h2> : null}
            {meta ? <span className={styles.panelMeta}>{meta}</span> : null}
          </div>
          {actions ? <div className={styles.panelActions}>{actions}</div> : null}
        </div>
      ) : null}
      <div className={flush ? styles.panelBodyFlush : styles.panelBody}>{children}</div>
    </section>
  );
}

interface SegmentedProps<T extends string> {
  value: T;
  options: ReadonlyArray<{ value: T; label: string }>;
  onChange: (value: T) => void;
  ariaLabel: string;
}

/** Radio-group style segmented control with arrow-key navigation. */
export function ProxxSegmented<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
}: SegmentedProps<T>) {
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    event.preventDefault();
    const index = options.findIndex((option) => option.value === value);
    const delta = event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1;
    const next = options[(index + delta + options.length) % options.length];
    onChange(next.value);
    const buttons = event.currentTarget.querySelectorAll<HTMLButtonElement>('button');
    buttons[options.indexOf(next)]?.focus();
  };

  return (
    <div
      className={styles.segmented}
      role="radiogroup"
      aria-label={ariaLabel}
      onKeyDown={handleKeyDown}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={active ? 0 : -1}
            className={active ? `${styles.segment} ${styles.segmentActive}` : styles.segment}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

export type BadgeTone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger';

export function ProxxBadge({
  tone = 'neutral',
  dot = false,
  title,
  children,
}: PropsWithChildren<{ tone?: BadgeTone; dot?: boolean; title?: string }>) {
  return (
    <span className={`${styles.badge} ${styles[`badge_${tone}`]}`} title={title}>
      {dot ? <i className={styles.badgeDot} aria-hidden="true" /> : null}
      {children}
    </span>
  );
}

interface KpiProps {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  accent?: string;
  loading?: boolean;
}

export function ProxxKpi({ label, value, hint, accent, loading }: KpiProps) {
  const labelId = useId();
  return (
    <div className={styles.kpi} role="group" aria-labelledby={labelId}>
      <span className={styles.kpiLabel} id={labelId}>
        {accent ? (
          <i className={styles.kpiAccent} style={{ background: accent }} aria-hidden="true" />
        ) : null}
        {label}
      </span>
      <strong className={loading ? `${styles.kpiValue} ${styles.kpiLoading}` : styles.kpiValue}>
        {value}
      </strong>
      {hint ? <span className={styles.kpiHint}>{hint}</span> : null}
    </div>
  );
}

/** Shown when the proxx endpoints are missing (stock CLIProxyAPI or an older proxx build). */
export function ProxxUnavailable({
  feature,
  compact = false,
}: {
  feature: string;
  compact?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div
      className={
        compact ? `${styles.unavailable} ${styles.unavailableCompact}` : styles.unavailable
      }
    >
      <span className={styles.unavailableIcon} aria-hidden="true">
        <IconSatellite size={18} />
      </span>
      <div>
        <div className={styles.unavailableTitle}>{t('proxx.unavailable.title')}</div>
        <p className={styles.unavailableText}>{t('proxx.unavailable.description', { feature })}</p>
      </div>
    </div>
  );
}

export function ProxxError({ message, onRetry }: { message: string; onRetry?: () => void }) {
  const { t } = useTranslation();
  return (
    <div className={styles.errorBox} role="alert">
      <span>{message}</span>
      {onRetry ? (
        <button type="button" className={styles.linkButton} onClick={onRetry}>
          {t('proxx.common.retry')}
        </button>
      ) : null}
    </div>
  );
}

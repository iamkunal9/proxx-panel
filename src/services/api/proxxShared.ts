/**
 * Shared readers for the proxx fork endpoints (/v8/management/proxx/*).
 */

import { isRecord } from '@/utils/helpers';

/**
 * The proxx endpoints only exist on a proxx backend. A stock CLIProxyAPI (or a proxx build that
 * predates a feature) answers 404 for the whole route, which the pages render as an empty state.
 */
export const isProxxUnavailable = (error: unknown): boolean =>
  isRecord(error) && (error.status === 404 || error.status === 501);

export const readText = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : typeof value === 'number' ? String(value) : '';

/** Finite non-negative number, or 0. */
export const readCount = (value: unknown): number => {
  const number = typeof value === 'string' && value.trim() ? Number(value) : value;
  return typeof number === 'number' && Number.isFinite(number) && number > 0 ? number : 0;
};

/** Finite number, or null when absent/invalid (never coerces "unknown" to 0). */
export const readNullableNumber = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null;
  const number = typeof value === 'string' ? Number(value) : value;
  return typeof number === 'number' && Number.isFinite(number) ? number : null;
};

export const readBool = (value: unknown): boolean =>
  value === true || (typeof value === 'string' && value.trim().toLowerCase() === 'true');

export const readList = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

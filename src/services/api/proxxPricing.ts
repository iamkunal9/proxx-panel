/**
 * proxx pricing API.
 *
 * The effective catalog comes from `GET /proxx/pricing` (USD per 1M tokens, underscore keys).
 * Overrides live in the config at `proxx.pricing.models` (hyphenated YAML keys) and the
 * `proxx.pricing.override-upstream` switch; both are written through the v8 config API.
 */

import { apiClient } from './client';
import { getConfigValue, guardConfigConnection } from './configValue';
import { readBool, readList, readNullableNumber, readText } from './proxxShared';
import type { CatalogPrice, PriceOverride, PricingCatalog } from '@/types/proxx';
import { isRecord } from '@/utils/helpers';

export const PRICE_OVERRIDES_CONFIG_PATH = '/config/proxx/pricing/models';
export const OVERRIDE_UPSTREAM_CONFIG_PATH = '/config/proxx/pricing/override-upstream';

/** Prices are never negative; anything else is treated as "not set". */
const readPrice = (value: unknown): number | null => {
  const number = readNullableNumber(value);
  return number !== null && number >= 0 ? number : null;
};

export function normalizePricingCatalog(raw: unknown): PricingCatalog {
  const record = isRecord(raw) ? raw : {};
  const models: CatalogPrice[] = readList(record.models)
    .filter(isRecord)
    .map((entry) => ({
      model: readText(entry.model),
      provider: readText(entry.provider),
      input: readPrice(entry.input),
      output: readPrice(entry.output),
      cacheRead: readPrice(entry.cache_read),
      cacheWrite: readPrice(entry.cache_write),
      source: readText(entry.source),
    }))
    .filter((entry) => entry.model);
  return {
    catalogSource: readText(record.catalog_source),
    updatedAt: readText(record.updated_at),
    overrideUpstream: readBool(record.override_upstream),
    models,
  };
}

/** Reads `proxx.pricing.models` from config (YAML keys). */
export function readPriceOverrides(raw: unknown): PriceOverride[] {
  return readList(raw)
    .filter(isRecord)
    .map((entry) => ({
      model: readText(entry.model),
      provider: readText(entry.provider),
      input: readPrice(entry.input),
      output: readPrice(entry.output),
      cacheRead: readPrice(entry['cache-read']),
      cacheWrite: readPrice(entry['cache-write']),
      reasoning: readPrice(entry.reasoning),
      override: readBool(entry.override),
    }))
    .filter((entry) => entry.model);
}

/** Serializes overrides to the config shape; unset prices fall back to the catalog. */
export function serializePriceOverrides(entries: PriceOverride[]): Record<string, unknown>[] {
  return entries
    .filter((entry) => entry.model.trim())
    .map((entry) => {
      const out: Record<string, unknown> = { model: entry.model.trim() };
      if (entry.provider.trim()) out.provider = entry.provider.trim();
      const fields: Array<[string, number | null]> = [
        ['input', entry.input],
        ['output', entry.output],
        ['cache-read', entry.cacheRead],
        ['cache-write', entry.cacheWrite],
        ['reasoning', entry.reasoning],
      ];
      for (const [key, value] of fields) {
        if (value !== null && Number.isFinite(value) && value >= 0) out[key] = value;
      }
      if (entry.override) out.override = true;
      return out;
    });
}

/** Parses a price input; empty means "use the catalog" (null), invalid input is undefined. */
export function parsePriceInput(text: string): number | null | undefined {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const number = Number(trimmed);
  return Number.isFinite(number) && number >= 0 ? number : undefined;
}

export const priceOverrideKey = (entry: { model: string; provider: string }): string =>
  `${entry.provider.trim().toLowerCase()}|${entry.model.trim().toLowerCase()}`;

export const proxxPricingApi = {
  async getCatalog(): Promise<PricingCatalog> {
    return normalizePricingCatalog(await apiClient.get<unknown>('/proxx/pricing'));
  },

  async getOverrides(): Promise<PriceOverride[]> {
    return readPriceOverrides(await getConfigValue<unknown>(PRICE_OVERRIDES_CONFIG_PATH, []));
  },

  async getOverrideUpstream(): Promise<boolean> {
    return readBool(await getConfigValue<unknown>(OVERRIDE_UPSTREAM_CONFIG_PATH, false));
  },

  /** Replaces the whole `proxx.pricing.models` list; pass the guard captured at load time. */
  async saveOverrides(
    entries: PriceOverride[],
    assertSameConnection: () => void = guardConfigConnection()
  ): Promise<void> {
    const payload = serializePriceOverrides(entries);
    assertSameConnection();
    await apiClient.put(PRICE_OVERRIDES_CONFIG_PATH, payload);
  },

  async setOverrideUpstream(
    enabled: boolean,
    assertSameConnection: () => void = guardConfigConnection()
  ): Promise<void> {
    assertSameConnection();
    await apiClient.put(OVERRIDE_UPSTREAM_CONFIG_PATH, enabled);
  },
};

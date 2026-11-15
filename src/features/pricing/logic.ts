import type { BadgeTone } from '@/components/proxx/ProxxPage';
import type { CatalogPrice } from '@/types/proxx';

export const priceSourceTone = (source: string): BadgeTone => {
  const value = source.toLowerCase();
  if (value.includes('config') || value.includes('override')) return 'accent';
  if (value.includes('upstream')) return 'success';
  if (!value || value === 'unknown') return 'warning';
  return 'neutral';
};

/** Case-insensitive match on model and provider; every whitespace-separated term must match. */
export function filterCatalog(models: CatalogPrice[], query: string): CatalogPrice[] {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return models;
  return models.filter((entry) => {
    const haystack = `${entry.model} ${entry.provider}`.toLowerCase();
    return terms.every((term) => haystack.includes(term));
  });
}

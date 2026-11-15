import { useCallback, useState } from 'react';
import { useApiKeysForModels } from '@/hooks/useApiKeysForModels';
import { useAuthStore, useModelsStore } from '@/stores';

/**
 * Client-visible model IDs from `/v1/models`, loaded on demand through the shared models store
 * (same source as the System page). Failures leave the list empty; pickers still accept free text.
 */
export function useModelOptions() {
  const apiBase = useAuthStore((state) => state.apiBase);
  const models = useModelsStore((state) => state.models);
  const fetchModels = useModelsStore((state) => state.fetchModels);
  const resolveApiKeys = useApiKeysForModels();
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!apiBase) return;
    setLoading(true);
    try {
      const keys = await resolveApiKeys();
      await fetchModels(apiBase, keys[0]);
    } catch {
      // The picker falls back to free text.
    } finally {
      setLoading(false);
    }
  }, [apiBase, fetchModels, resolveApiKeys]);

  const options = Array.from(
    new Set(models.map((model) => model.name.trim()).filter(Boolean))
  ).sort((a, b) => a.localeCompare(b));

  return { options, loading, load };
}

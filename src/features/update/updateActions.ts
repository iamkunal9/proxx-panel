import { guardConfigConnection } from '@/services/api/configValue';
import { proxxUpdateApi } from '@/services/api/proxxUpdate';
import type { UpdateConfig } from '@/types/proxx';
import { diffUpdateConfig } from './logic/updateLogic';

/** Writes only the changed settings, one `PUT /config/proxx/update/<key>` each, in order. */
export async function saveUpdateSettings(
  original: UpdateConfig,
  next: UpdateConfig,
  assertSameConnection: () => void = guardConfigConnection()
): Promise<number> {
  const changes = diffUpdateConfig(original, next);
  for (const change of changes) {
    await proxxUpdateApi.setConfig(change.key, change.value, assertSameConnection);
  }
  return changes.length;
}

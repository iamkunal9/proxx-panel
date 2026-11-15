/**
 * proxx model groups API.
 *
 * Live status comes from `GET /proxx/groups`. Group definitions live in the config at
 * `proxx.model-groups` and are edited through the v8 config API: the list is read from
 * `/config/proxx/model-groups` and replaced whole with a PUT (config lists have no stable IDs).
 */

import { apiClient } from './client';
import { getConfigValue, guardConfigConnection } from './configValue';
import { readBool, readCount, readList, readText } from './proxxShared';
import type {
  ModelGroupConfig,
  ModelGroupMemberStatus,
  ModelGroupStatus,
  ModelGroupStrategy,
} from '@/types/proxx';
import { isRecord } from '@/utils/helpers';

export const MODEL_GROUPS_CONFIG_PATH = '/config/proxx/model-groups';

export const MODEL_GROUP_STRATEGIES: readonly ModelGroupStrategy[] = ['ordered', 'round-robin'];

export function normalizeModelGroupStrategy(value: unknown): ModelGroupStrategy {
  const text = readText(value)
    .toLowerCase()
    .replace(/[\s_]+/g, '-');
  return text === 'round-robin' || text === 'roundrobin' || text === 'rr'
    ? 'round-robin'
    : 'ordered';
}

const readModelNames = (value: unknown): string[] => {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const entry of readList(value)) {
    const name = readText(entry);
    if (name && !seen.has(name)) {
      seen.add(name);
      result.push(name);
    }
  }
  return result;
};

function normalizeMember(raw: unknown): ModelGroupMemberStatus | null {
  if (typeof raw === 'string') {
    const model = raw.trim();
    return model
      ? { model, providers: [], available: false, cooldownUntil: null, credentials: 0 }
      : null;
  }
  if (!isRecord(raw)) return null;
  const model = readText(raw.model);
  if (!model) return null;
  const cooldownUntil = readText(raw.cooldown_until);
  return {
    model,
    providers: readModelNames(raw.providers),
    available: readBool(raw.available),
    cooldownUntil: cooldownUntil || null,
    credentials: Math.floor(readCount(raw.credentials)),
  };
}

export function normalizeModelGroupsStatus(raw: unknown): ModelGroupStatus[] {
  const groups = isRecord(raw) ? readList(raw.groups) : readList(raw);
  return groups.filter(isRecord).flatMap((group) => {
    const name = readText(group.name);
    if (!name) return [];
    return [
      {
        name,
        strategy: normalizeModelGroupStrategy(group.strategy),
        hidden: readBool(group.hidden),
        members: readList(group.members)
          .map(normalizeMember)
          .filter((member): member is ModelGroupMemberStatus => member !== null),
      },
    ];
  });
}

/** Reads `proxx.model-groups` from config (YAML keys). */
export function readModelGroupsConfig(raw: unknown): ModelGroupConfig[] {
  return readList(raw)
    .filter(isRecord)
    .map((group) => ({
      name: readText(group.name),
      strategy: normalizeModelGroupStrategy(group.strategy),
      models: readModelNames(group.models),
      hidden: readBool(group.hidden),
    }))
    .filter((group) => group.name);
}

/** Serializes groups back to the config shape; defaults are omitted like the backend does. */
export function serializeModelGroupsConfig(groups: ModelGroupConfig[]): Record<string, unknown>[] {
  return groups.map((group) => {
    const entry: Record<string, unknown> = { name: group.name.trim() };
    if (group.strategy === 'round-robin') entry.strategy = 'round-robin';
    entry.models = readModelNames(group.models);
    if (group.hidden) entry.hidden = true;
    return entry;
  });
}

export type ModelGroupValidationError =
  | 'name_required'
  | 'name_invalid'
  | 'name_duplicate'
  | 'models_required'
  | 'self_reference';

/** Validates one group against the others; returns the first problem or null. */
export function validateModelGroup(
  group: ModelGroupConfig,
  others: ModelGroupConfig[]
): ModelGroupValidationError | null {
  const name = group.name.trim();
  if (!name) return 'name_required';
  if (/\s/.test(name)) return 'name_invalid';
  if (others.some((other) => other.name.trim().toLowerCase() === name.toLowerCase())) {
    return 'name_duplicate';
  }
  if (!group.models.some((model) => model.trim())) return 'models_required';
  if (group.models.some((model) => model.trim().toLowerCase() === name.toLowerCase())) {
    return 'self_reference';
  }
  return null;
}

/** Moves one item by `delta` positions, clamped to the list bounds. */
export function moveItem<T>(list: readonly T[], index: number, delta: number): T[] {
  const next = list.slice();
  const target = Math.max(0, Math.min(list.length - 1, index + delta));
  if (index < 0 || index >= list.length || target === index) return next;
  const [item] = next.splice(index, 1);
  next.splice(target, 0, item);
  return next;
}

export const proxxGroupsApi = {
  async getStatus(): Promise<ModelGroupStatus[]> {
    return normalizeModelGroupsStatus(await apiClient.get<unknown>('/proxx/groups'));
  },

  async getConfig(): Promise<ModelGroupConfig[]> {
    return readModelGroupsConfig(await getConfigValue<unknown>(MODEL_GROUPS_CONFIG_PATH, []));
  },

  /**
   * Replaces the whole `proxx.model-groups` list. Pass the guard captured when the draft was
   * loaded (`guardConfigConnection()`) so a draft never lands on a different connection.
   */
  async saveConfig(
    groups: ModelGroupConfig[],
    assertSameConnection: () => void = guardConfigConnection()
  ): Promise<void> {
    const payload = serializeModelGroupsConfig(groups);
    assertSameConnection();
    await apiClient.put(MODEL_GROUPS_CONFIG_PATH, payload);
  },
};

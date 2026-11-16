import type { ModelGroupConfig, ModelGroupMemberStatus, ModelGroupStatus } from '@/types/proxx';

export interface GroupView {
  config: ModelGroupConfig | null;
  name: string;
  strategy: ModelGroupConfig['strategy'];
  hidden: boolean;
  members: Array<{ model: string; status: ModelGroupMemberStatus | null }>;
}

/** Config is the source of truth for editing; live status decorates it by name. */
export function buildGroupViews(
  config: ModelGroupConfig[],
  status: ModelGroupStatus[] | null
): GroupView[] {
  const statusByName = new Map((status ?? []).map((group) => [group.name, group]));
  const views: GroupView[] = config.map((group) => {
    const live = statusByName.get(group.name);
    const membersByModel = new Map((live?.members ?? []).map((member) => [member.model, member]));
    return {
      config: group,
      name: group.name,
      strategy: group.strategy,
      hidden: group.hidden,
      members: group.models.map((model) => ({ model, status: membersByModel.get(model) ?? null })),
    };
  });
  const configured = new Set(config.map((group) => group.name));
  for (const live of status ?? []) {
    if (configured.has(live.name)) continue;
    views.push({
      config: null,
      name: live.name,
      strategy: live.strategy,
      hidden: live.hidden,
      members: live.members.map((member) => ({ model: member.model, status: member })),
    });
  }
  return views;
}

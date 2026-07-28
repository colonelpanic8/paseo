import type { Agent, WorkspaceDescriptor } from "@/stores/session-store";
import { isWorkspaceRootAgent } from "@/subagents/policies";
import { deriveSidebarStateBucket } from "./sidebar-agent-state";

export const EMPTY_WORKSPACE_PROVIDERS: readonly string[] = [];

export interface WorkspaceAgentActivity {
  agentId: string;
  status: WorkspaceDescriptor["status"];
  enteredAt: Date | null;
  /**
   * Distinct providers with a live root agent in the workspace, ordered by each
   * provider's most recent activity, descending. `providers[0]` is the provider
   * of the agent that won the recency contest for `agentId`.
   */
  providers: readonly string[];
}

export function buildWorkspaceAgentActivityIndex(
  agents: ReadonlyMap<string, Agent>,
  previous?: ReadonlyMap<string, WorkspaceAgentActivity>,
): Map<string, WorkspaceAgentActivity> {
  const activityByWorkspaceId = new Map<string, WorkspaceAgentActivity>();
  const latestActivityAtByWorkspaceId = new Map<string, Date>();
  // Providers are collected for every live root agent, not just the recency
  // winner, so the row can show one icon per provider working in the workspace.
  const providerActivityByWorkspaceId = new Map<string, Map<string, number>>();

  for (const agent of agents.values()) {
    const parentAgent = agent.parentAgentId ? agents.get(agent.parentAgentId) : undefined;
    if (agent.archivedAt || !agent.workspaceId || !isWorkspaceRootAgent(agent, parentAgent)) {
      continue;
    }

    const enteredAt = agent.attentionTimestamp ?? agent.updatedAt;
    recordProviderActivity({
      providerActivityByWorkspaceId,
      workspaceId: agent.workspaceId,
      provider: agent.provider,
      status: agent.status,
      enteredAt,
    });

    const latestActivityAt = latestActivityAtByWorkspaceId.get(agent.workspaceId);
    if (latestActivityAt && enteredAt <= latestActivityAt) {
      continue;
    }
    latestActivityAtByWorkspaceId.set(agent.workspaceId, enteredAt);

    const status = deriveSidebarStateBucket({
      status: agent.status,
      pendingPermissionCount: agent.pendingPermissions.length,
      requiresAttention: agent.requiresAttention,
      attentionReason: agent.attentionReason,
    });
    activityByWorkspaceId.set(agent.workspaceId, {
      agentId: agent.id,
      status,
      enteredAt,
      providers: EMPTY_WORKSPACE_PROVIDERS,
    });
  }

  for (const [workspaceId, activity] of activityByWorkspaceId) {
    const previousActivity = previous?.get(workspaceId);
    const orderedProviders = orderProvidersByRecency(
      providerActivityByWorkspaceId.get(workspaceId),
    );
    // Sidebar entries compare provider lists by reference, so hold on to the
    // previous array whenever its contents still match.
    const providers =
      previousActivity && areProviderListsEqual(previousActivity.providers, orderedProviders)
        ? previousActivity.providers
        : orderedProviders;

    if (
      previousActivity?.agentId === activity.agentId &&
      previousActivity.status === activity.status &&
      previousActivity.providers === providers
    ) {
      activityByWorkspaceId.set(workspaceId, previousActivity);
      continue;
    }
    activityByWorkspaceId.set(workspaceId, { ...activity, providers });
  }

  if (previous && areWorkspaceAgentActivityIndexesIdentical(previous, activityByWorkspaceId)) {
    return previous instanceof Map ? previous : new Map(previous);
  }
  return activityByWorkspaceId;
}

function recordProviderActivity(input: {
  providerActivityByWorkspaceId: Map<string, Map<string, number>>;
  workspaceId: string;
  provider: string | undefined;
  status: Agent["status"];
  enteredAt: Date;
}): void {
  if (!input.provider || input.status === "closed" || input.status === "error") {
    return;
  }
  let byProvider = input.providerActivityByWorkspaceId.get(input.workspaceId);
  if (!byProvider) {
    byProvider = new Map<string, number>();
    input.providerActivityByWorkspaceId.set(input.workspaceId, byProvider);
  }
  const enteredAtMs = input.enteredAt.getTime();
  const latestMs = byProvider.get(input.provider);
  if (latestMs === undefined || enteredAtMs > latestMs) {
    byProvider.set(input.provider, enteredAtMs);
  }
}

function orderProvidersByRecency(
  providerActivity: ReadonlyMap<string, number> | undefined,
): readonly string[] {
  if (!providerActivity || providerActivity.size === 0) {
    return EMPTY_WORKSPACE_PROVIDERS;
  }
  return Array.from(providerActivity.entries())
    .sort(([, leftMs], [, rightMs]) => rightMs - leftMs)
    .map(([provider]) => provider);
}

function areProviderListsEqual(left: readonly string[], right: readonly string[]): boolean {
  if (left === right) {
    return true;
  }
  return left.length === right.length && left.every((provider, index) => provider === right[index]);
}

function areWorkspaceAgentActivityIndexesIdentical(
  previous: ReadonlyMap<string, WorkspaceAgentActivity>,
  next: ReadonlyMap<string, WorkspaceAgentActivity>,
): boolean {
  if (previous.size !== next.size) {
    return false;
  }
  for (const [workspaceId, activity] of next) {
    if (previous.get(workspaceId) !== activity) {
      return false;
    }
  }
  return true;
}

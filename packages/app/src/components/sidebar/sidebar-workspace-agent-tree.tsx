import { useCallback, useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import equal from "fast-deep-equal";
import { useStoreWithEqualityFn } from "zustand/traditional";
import type { AgentLifecycleStatus } from "@getpaseo/protocol/agent-lifecycle";
import { AgentStatusDot } from "@/components/agent-status-dot";
import { usePendingArchiveAgentIds } from "@/hooks/use-archive-agent";
import { navigateToWorkspace } from "@/stores/navigation-active-workspace-store";
import { useSessionStore, type Agent } from "@/stores/session-store";
import { isWorkspaceRootAgent } from "@/subagents/policies";
import { providerSubagentLifecycleStatus } from "@/subagents/provider-store";
import { useSubagentsForParent, type SubagentRow } from "@/subagents/select";
import { resolveRowLabel } from "@/subagents/track-presentation";
import { SPACING } from "@/styles/theme";
import { inlineUnistylesStyle } from "@/styles/unistyles-inline-style";
import { navigateToAgent } from "@/utils/navigate-to-agent";
import { normalizeWorkspaceOpaqueId } from "@/utils/workspace-identity";

/**
 * Depth-0 agent dots sit on the workspace row's own leading rail (its left
 * padding) rather than the title rail — hierarchy under the row reads from the
 * per-depth steps, not from a large base offset. Status mode passes its own
 * rail.
 */
export const AGENT_TREE_PROJECT_MODE_INDENT = SPACING[2];
const AGENT_TREE_INDENT_PER_DEPTH = SPACING[4];
/** Deeper fan-outs stop rendering rather than nesting the sidebar off-screen. */
const MAX_AGENT_TREE_DEPTH = 5;

/** Last-resort row name when neither the agent nor its subagent reports one. */
function formatProviderLabel(provider: string | null | undefined): string {
  if (!provider) {
    return "Agent";
  }
  return provider
    .split(/[-_\s]+/)
    .filter((part) => part.length > 0)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

interface AgentTreeRowBase {
  id: string;
  label: string;
  status: AgentLifecycleStatus;
  requiresAttention: boolean;
  /** `null` when the source row does not report one. */
  attentionReason: "finished" | "error" | "permission" | null;
  pendingPermissionCount: number;
}

interface PaseoAgentTreeRow extends AgentTreeRowBase {
  kind: "paseo";
}

interface ProviderAgentTreeRow extends AgentTreeRowBase {
  kind: "provider";
  parentAgentId: string;
}

type AgentTreeRow = PaseoAgentTreeRow | ProviderAgentTreeRow;

type SessionStoreSnapshot = ReturnType<typeof useSessionStore.getState>;

const EMPTY_AGENT_TREE_ROWS: PaseoAgentTreeRow[] = [];
const EMPTY_ROOT_AGENT_INDEX: ReadonlyMap<string, string[]> = new Map();

/**
 * Root agent ids per workspace, derived once per `agents` map identity. Every
 * sidebar row reads this index, so it has to stay O(1) while the map reference
 * is unchanged.
 */
const rootAgentIndexCache = new WeakMap<Map<string, Agent>, ReadonlyMap<string, string[]>>();

interface RootAgentEntry {
  workspaceId: string;
  agent: Agent;
}

function buildRootAgentIndex(agents: Map<string, Agent>): ReadonlyMap<string, string[]> {
  const entries: RootAgentEntry[] = [];
  for (const agent of agents.values()) {
    if (agent.archivedAt) {
      continue;
    }
    const workspaceId = normalizeWorkspaceOpaqueId(agent.workspaceId);
    if (!workspaceId) {
      continue;
    }
    const parentAgent = agent.parentAgentId ? agents.get(agent.parentAgentId) : undefined;
    if (!isWorkspaceRootAgent(agent, parentAgent)) {
      continue;
    }
    entries.push({ workspaceId, agent });
  }
  entries.sort((left, right) => left.agent.createdAt.getTime() - right.agent.createdAt.getTime());

  const index = new Map<string, string[]>();
  for (const entry of entries) {
    const existing = index.get(entry.workspaceId);
    if (existing) {
      existing.push(entry.agent.id);
    } else {
      index.set(entry.workspaceId, [entry.agent.id]);
    }
  }
  return index;
}

function getRootAgentIndex(agents: Map<string, Agent> | undefined): ReadonlyMap<string, string[]> {
  if (!agents) {
    return EMPTY_ROOT_AGENT_INDEX;
  }
  const cached = rootAgentIndexCache.get(agents);
  if (cached) {
    return cached;
  }
  const index = buildRootAgentIndex(agents);
  rootAgentIndexCache.set(agents, index);
  return index;
}

function toRootAgentTreeRow(agent: Agent): PaseoAgentTreeRow {
  return {
    kind: "paseo",
    id: agent.id,
    label: resolveRowLabel(agent.title) ?? formatProviderLabel(agent.provider),
    status: agent.status,
    requiresAttention: agent.requiresAttention === true,
    attentionReason: agent.attentionReason ?? null,
    pendingPermissionCount: agent.pendingPermissions.length,
  };
}

/**
 * Mirrors how the subagents track names a row: the task it was given, then the
 * subagent type, then the provider's own compact context. The task line and the
 * compact context are provider-only — a managed agent has a real title, so it
 * never carries either.
 */
function resolveChildAgentTreeLabel(row: SubagentRow): string {
  const providerDescription = row.kind === "provider" ? resolveRowLabel(row.description) : null;
  const providerSubtitle = row.kind === "provider" ? resolveRowLabel(row.subtitle) : null;
  return (
    providerDescription ??
    resolveRowLabel(row.title) ??
    providerSubtitle ??
    formatProviderLabel(row.provider)
  );
}

function toChildAgentTreeRow(row: SubagentRow): AgentTreeRow {
  const label = resolveChildAgentTreeLabel(row);
  if (row.kind === "provider") {
    return {
      kind: "provider",
      id: row.id,
      parentAgentId: row.parentAgentId,
      label,
      status: providerSubagentLifecycleStatus(row.status),
      requiresAttention: row.requiresAttention,
      attentionReason: null,
      pendingPermissionCount: 0,
    };
  }
  return {
    kind: "paseo",
    id: row.id,
    label,
    status: row.status,
    requiresAttention: row.requiresAttention === true,
    attentionReason: null,
    pendingPermissionCount: 0,
  };
}

function selectRootAgentTreeRows(
  state: SessionStoreSnapshot,
  serverId: string,
  workspaceId: string | null,
  pendingArchiveIds: ReadonlySet<string>,
): PaseoAgentTreeRow[] {
  if (!workspaceId) {
    return EMPTY_AGENT_TREE_ROWS;
  }
  const session = state.sessions[serverId];
  const agents = session?.agents;
  const rootAgentIds = getRootAgentIndex(agents).get(workspaceId);
  if (!agents || !rootAgentIds) {
    return EMPTY_AGENT_TREE_ROWS;
  }

  const rows: PaseoAgentTreeRow[] = [];
  for (const agentId of rootAgentIds) {
    if (pendingArchiveIds.has(agentId)) {
      continue;
    }
    const agent = agents.get(agentId);
    if (agent) {
      rows.push(toRootAgentTreeRow(agent));
    }
  }
  return rows.length > 0 ? rows : EMPTY_AGENT_TREE_ROWS;
}

/** Whether the workspace has at least one agent the tree would render. */
export function useWorkspaceHasAgents(input: { serverId: string; workspaceId: string }): boolean {
  const workspaceId = normalizeWorkspaceOpaqueId(input.workspaceId);
  return useSessionStore((state) => {
    if (!workspaceId) {
      return false;
    }
    return getRootAgentIndex(state.sessions[input.serverId]?.agents).has(workspaceId);
  });
}

/** The per-tree facts every nested row needs, so they are drilled as one value. */
interface AgentTreeContext {
  serverId: string;
  workspaceId: string;
  /** Left rail of the owning row's title, which depth-0 rows line up with. */
  baseIndent: number;
}

/** Full agent hierarchy for one workspace, rendered under its sidebar row. */
export function WorkspaceAgentTree({
  serverId,
  workspaceId,
  baseIndent = AGENT_TREE_PROJECT_MODE_INDENT,
}: {
  serverId: string;
  workspaceId: string;
  baseIndent?: number;
}) {
  const normalizedWorkspaceId = normalizeWorkspaceOpaqueId(workspaceId);
  const pendingArchiveIds = usePendingArchiveAgentIds(serverId);
  const rows = useStoreWithEqualityFn(
    useSessionStore,
    (state) => selectRootAgentTreeRows(state, serverId, normalizedWorkspaceId, pendingArchiveIds),
    equal,
  );
  const tree = useMemo(
    () => ({ serverId, workspaceId, baseIndent }),
    [baseIndent, serverId, workspaceId],
  );

  if (rows.length === 0) {
    return null;
  }

  return (
    <View style={styles.tree}>
      {rows.map((row) => (
        <AgentTreeNode key={row.id} tree={tree} row={row} depth={0} />
      ))}
    </View>
  );
}

function AgentTreeNode({
  tree,
  row,
  depth,
}: {
  tree: AgentTreeContext;
  row: AgentTreeRow;
  depth: number;
}) {
  const canNest = row.kind === "paseo" && depth + 1 < MAX_AGENT_TREE_DEPTH;
  return (
    <>
      <AgentTreeRowItem tree={tree} row={row} depth={depth} />
      {canNest ? <AgentTreeChildren tree={tree} parentAgentId={row.id} depth={depth + 1} /> : null}
    </>
  );
}

function AgentTreeChildren({
  tree,
  parentAgentId,
  depth,
}: {
  tree: AgentTreeContext;
  parentAgentId: string;
  depth: number;
}) {
  const subagentRows = useSubagentsForParent({ serverId: tree.serverId, parentAgentId });
  const rows = useMemo(() => subagentRows.map(toChildAgentTreeRow), [subagentRows]);
  return (
    <>
      {rows.map((row) => (
        <AgentTreeNode key={`${row.kind}:${row.id}`} tree={tree} row={row} depth={depth} />
      ))}
    </>
  );
}

function AgentTreeRowItem({
  tree,
  row,
  depth,
}: {
  tree: AgentTreeContext;
  row: AgentTreeRow;
  depth: number;
}) {
  const [isHovered, setIsHovered] = useState(false);
  const handleHoverIn = useCallback(() => setIsHovered(true), []);
  const handleHoverOut = useCallback(() => setIsHovered(false), []);

  const rowStyle = useMemo(
    () => [
      styles.row,
      isHovered && styles.rowHovered,
      inlineUnistylesStyle({
        paddingLeft: tree.baseIndent + depth * AGENT_TREE_INDENT_PER_DEPTH,
      }),
    ],
    [depth, isHovered, tree.baseIndent],
  );

  const handlePress = useCallback(() => {
    if (row.kind === "provider") {
      navigateToWorkspace({
        serverId: tree.serverId,
        workspaceId: tree.workspaceId,
        target: {
          kind: "provider_subagent",
          parentAgentId: row.parentAgentId,
          subagentId: row.id,
        },
      });
      return;
    }
    navigateToAgent({ serverId: tree.serverId, agentId: row.id });
  }, [row, tree.serverId, tree.workspaceId]);

  return (
    <Pressable
      accessibilityRole="button"
      style={rowStyle}
      onHoverIn={handleHoverIn}
      onHoverOut={handleHoverOut}
      onPress={handlePress}
      testID={`sidebar-agent-tree-row-${row.kind}-${row.id}`}
    >
      <View style={styles.statusSlot}>
        <AgentStatusDot
          status={row.status}
          requiresAttention={row.requiresAttention}
          attentionReason={row.attentionReason}
          pendingPermissionCount={row.pendingPermissionCount}
          showInactive
        />
      </View>
      <Text style={styles.title} numberOfLines={1}>
        {row.label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create((theme) => ({
  tree: {
    marginBottom: theme.spacing[1],
  },
  row: {
    minHeight: 26,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingVertical: theme.spacing[1],
    paddingRight: theme.spacing[3],
    borderRadius: theme.borderRadius.md,
  },
  rowHovered: {
    backgroundColor: theme.colors.surfaceSidebarHover,
  },
  statusSlot: {
    width: 8,
    height: 8,
    flexShrink: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  title: {
    flex: 1,
    minWidth: 0,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.normal,
    lineHeight: 16,
  },
}));

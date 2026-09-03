import { z } from "zod";

export interface CollapsedProjectsState {
  collapsedProjectKeys: Set<string>;
  collapsedStatusGroupKeys: Set<string>;
  collapsedPinned: boolean;
  /** Workspace keys (`${serverId}:${workspaceId}`) whose agent tree is open. */
  expandedAgentTreeWorkspaceKeys: Set<string>;
}

export interface PersistedCollapsedProjects {
  collapsedProjectKeys?: string[];
  collapsedStatusGroupKeys?: string[];
  collapsedPinned?: boolean;
  expandedAgentTreeWorkspaceKeys?: string[];
}

export const PersistedCollapsedProjectsSchema: z.ZodType<PersistedCollapsedProjects> =
  z.strictObject({
    collapsedProjectKeys: z.array(z.string()).optional(),
    collapsedStatusGroupKeys: z.array(z.string()).optional(),
    collapsedPinned: z.boolean().optional(),
    expandedAgentTreeWorkspaceKeys: z.array(z.string()).optional(),
  });

export function togglePinnedCollapsed(state: CollapsedProjectsState): CollapsedProjectsState {
  return { ...state, collapsedPinned: !state.collapsedPinned };
}

export function toggleProjectCollapsed(
  state: CollapsedProjectsState,
  projectKey: string,
): CollapsedProjectsState {
  const next = new Set(state.collapsedProjectKeys);
  if (next.has(projectKey)) {
    next.delete(projectKey);
  } else {
    next.add(projectKey);
  }
  return { ...state, collapsedProjectKeys: next };
}

// Status groups that start collapsed for everyone, including users whose
// persisted state predates the bucket's existence.
const DEFAULT_COLLAPSED_STATUS_GROUP_KEYS: ReadonlySet<string> = new Set(["snoozed"]);

// The persisted set stores "the user toggled this group away from its default".
// For normal groups presence = collapsed. For default-collapsed groups the
// semantics INVERT: presence = the user expanded it. Keeping the persisted shape
// and toggle functions unchanged preserves back-compat with stored state.
export function isStatusGroupCollapsed(
  collapsedStatusGroupKeys: ReadonlySet<string>,
  statusGroupKey: string,
): boolean {
  const toggledByUser = collapsedStatusGroupKeys.has(statusGroupKey);
  return DEFAULT_COLLAPSED_STATUS_GROUP_KEYS.has(statusGroupKey) ? !toggledByUser : toggledByUser;
}

export function toggleStatusGroupCollapsed(
  state: CollapsedProjectsState,
  statusGroupKey: string,
): CollapsedProjectsState {
  const next = new Set(state.collapsedStatusGroupKeys);
  if (next.has(statusGroupKey)) {
    next.delete(statusGroupKey);
  } else {
    next.add(statusGroupKey);
  }
  return { ...state, collapsedStatusGroupKeys: next };
}

export function toggleAgentTreeExpanded(
  state: CollapsedProjectsState,
  workspaceKey: string,
): CollapsedProjectsState {
  const next = new Set(state.expandedAgentTreeWorkspaceKeys);
  if (next.has(workspaceKey)) {
    next.delete(workspaceKey);
  } else {
    next.add(workspaceKey);
  }
  return { ...state, expandedAgentTreeWorkspaceKeys: next };
}

export function setProjectCollapsed(
  state: CollapsedProjectsState,
  projectKey: string,
  collapsed: boolean,
): CollapsedProjectsState {
  const next = new Set(state.collapsedProjectKeys);
  if (collapsed) {
    next.add(projectKey);
  } else {
    next.delete(projectKey);
  }
  return { ...state, collapsedProjectKeys: next };
}

export function serializeCollapsedProjects(state: CollapsedProjectsState): {
  collapsedProjectKeys: string[];
  collapsedStatusGroupKeys: string[];
  collapsedPinned: boolean;
  expandedAgentTreeWorkspaceKeys: string[];
} {
  return {
    collapsedProjectKeys: Array.from(state.collapsedProjectKeys),
    collapsedStatusGroupKeys: Array.from(state.collapsedStatusGroupKeys),
    collapsedPinned: state.collapsedPinned,
    expandedAgentTreeWorkspaceKeys: Array.from(state.expandedAgentTreeWorkspaceKeys),
  };
}

export function mergePersistedCollapsedProjects<S extends CollapsedProjectsState>(
  persistedValue: unknown,
  current: S,
): S {
  const result = PersistedCollapsedProjectsSchema.safeParse(persistedValue);
  if (!result.success) {
    return current;
  }
  const persisted = result.data;
  const restoredProjects = deserializeCollapsedKeys(
    persisted.collapsedProjectKeys ?? Array.from(current.collapsedProjectKeys),
  );
  const restoredStatusGroups = deserializeCollapsedKeys(
    persisted.collapsedStatusGroupKeys ?? Array.from(current.collapsedStatusGroupKeys),
  );
  const restoredAgentTrees = deserializeCollapsedKeys(
    persisted.expandedAgentTreeWorkspaceKeys ?? Array.from(current.expandedAgentTreeWorkspaceKeys),
  );
  const restoredPinned = persisted.collapsedPinned ?? current.collapsedPinned;
  if (
    areSetsEqual(current.collapsedProjectKeys, restoredProjects) &&
    areSetsEqual(current.collapsedStatusGroupKeys, restoredStatusGroups) &&
    areSetsEqual(current.expandedAgentTreeWorkspaceKeys, restoredAgentTrees) &&
    current.collapsedPinned === restoredPinned
  ) {
    return current;
  }
  return {
    ...current,
    collapsedProjectKeys: restoredProjects,
    collapsedStatusGroupKeys: restoredStatusGroups,
    collapsedPinned: restoredPinned,
    expandedAgentTreeWorkspaceKeys: restoredAgentTrees,
  };
}

function deserializeCollapsedKeys(value: string[]): Set<string> {
  return new Set(value);
}

function areSetsEqual(left: Set<string>, right: Set<string>): boolean {
  if (left.size !== right.size) {
    return false;
  }
  for (const key of left) {
    if (!right.has(key)) {
      return false;
    }
  }
  return true;
}

export interface CollapsedProjectsState {
  collapsedProjectKeys: Set<string>;
  collapsedStatusGroupKeys: Set<string>;
  collapsedPinned: boolean;
}

export interface PersistedCollapsedProjects {
  collapsedProjectKeys?: unknown;
  collapsedStatusGroupKeys?: unknown;
  collapsedPinned?: unknown;
}

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
} {
  return {
    collapsedProjectKeys: Array.from(state.collapsedProjectKeys),
    collapsedStatusGroupKeys: Array.from(state.collapsedStatusGroupKeys),
    collapsedPinned: state.collapsedPinned,
  };
}

export function mergePersistedCollapsedProjects<S extends CollapsedProjectsState>(
  persisted: PersistedCollapsedProjects | undefined,
  current: S,
): S {
  if (
    !persisted?.collapsedProjectKeys &&
    !persisted?.collapsedStatusGroupKeys &&
    persisted?.collapsedPinned === undefined
  ) {
    return current;
  }
  const restoredProjects = deserializeCollapsedKeys(persisted.collapsedProjectKeys);
  const restoredStatusGroups = deserializeCollapsedKeys(persisted.collapsedStatusGroupKeys);
  const restoredPinned =
    typeof persisted.collapsedPinned === "boolean"
      ? persisted.collapsedPinned
      : current.collapsedPinned;
  if (
    areSetsEqual(current.collapsedProjectKeys, restoredProjects) &&
    areSetsEqual(current.collapsedStatusGroupKeys, restoredStatusGroups) &&
    current.collapsedPinned === restoredPinned
  ) {
    return current;
  }
  return {
    ...current,
    collapsedProjectKeys: restoredProjects,
    collapsedStatusGroupKeys: restoredStatusGroups,
    collapsedPinned: restoredPinned,
  };
}

function deserializeCollapsedKeys(value: unknown): Set<string> {
  if (!Array.isArray(value)) {
    return new Set();
  }
  return new Set(value.filter((key): key is string => typeof key === "string"));
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

import { useCallback, useMemo, useState } from "react";
import type { StatusGroup } from "@/hooks/sidebar-status-view-model";
import type { ArchivedWorkspaceEntry } from "@/hooks/use-archived-workspaces";
import type { SidebarWorkspaceEntry } from "@/hooks/use-sidebar-workspaces-list";
import { selectSidebarGroupVisibility } from "@/components/sidebar/sidebar-group-visibility";
import type { ActiveWorkspaceSelection } from "@/stores/last-workspace-selection";

/** One status group as the list is about to render it, limit already applied. */
export interface LimitedStatusGroup {
  group: StatusGroup;
  collapsed: boolean;
  /** The open workspace when the collapsed limit would hide it; rendered before `visibleRows`. */
  leadingRow: SidebarWorkspaceEntry | null;
  visibleRows: SidebarWorkspaceEntry[];
  expanded: boolean;
  canToggle: boolean;
}

const NO_EXPANDED_BUCKETS: ReadonlySet<string> = new Set();

const STATUS_GROUP_VISIBILITY = {
  kind: "workspaces" as const,
  getStatusBucket: (workspace: SidebarWorkspaceEntry) => workspace.statusBucket,
  isReadyToReview: (workspace: SidebarWorkspaceEntry) => workspace.readyToReview,
};

/**
 * Show-more state for every status group at once. It lives above the groups so
 * the list can describe the exact rows it is rendering in the settle signature;
 * a group that kept its own expansion would move its neighbors without the list
 * ever knowing.
 */
export function useLimitedStatusGroups(
  groups: StatusGroup[],
  collapsedStatusGroupKeys: ReadonlySet<string>,
  selection: ActiveWorkspaceSelection | null,
) {
  const [expandedBuckets, setExpandedBuckets] = useState(NO_EXPANDED_BUCKETS);
  const toggleGroupExpanded = useCallback((bucket: string) => {
    setExpandedBuckets((current) => {
      const next = new Set(current);
      if (!next.delete(bucket)) next.add(bucket);
      return next;
    });
  }, []);
  const limitedGroups = useMemo<LimitedStatusGroup[]>(
    () =>
      groups.map((group) => {
        const expanded = expandedBuckets.has(group.bucket);
        const visibility = selectSidebarGroupVisibility({
          items: group.rows,
          expanded,
          policy: STATUS_GROUP_VISIBILITY,
          selection,
        });
        return {
          group,
          collapsed: collapsedStatusGroupKeys.has(group.bucket),
          leadingRow: visibility.leadingItem,
          visibleRows: visibility.visibleItems,
          expanded,
          canToggle: visibility.canToggle,
        };
      }),
    [collapsedStatusGroupKeys, expandedBuckets, groups, selection],
  );
  return { limitedGroups, toggleGroupExpanded };
}

/**
 * Everything that decides where a sidebar element lands, in render order. It
 * drives the shared settle, so it has to change whenever an element moves and
 * hold still whenever one merely re-renders in place — see sidebar-motion.ts
 * for why the whole flow has to re-render together for a web layout transition
 * to run.
 */
export function buildStatusLayoutSignature({
  hasListHeader,
  pinnedCollapsed,
  leadingPinnedWorkspace,
  visiblePinnedWorkspaces,
  canTogglePinnedWorkspaces,
  limitedGroups,
  archivedWorkspaces,
}: {
  hasListHeader: boolean;
  pinnedCollapsed: boolean;
  leadingPinnedWorkspace: SidebarWorkspaceEntry | null;
  visiblePinnedWorkspaces: SidebarWorkspaceEntry[];
  canTogglePinnedWorkspaces: boolean;
  limitedGroups: LimitedStatusGroup[];
  archivedWorkspaces: ArchivedWorkspaceEntry[];
}): string {
  const parts: string[] = [
    `header:${hasListHeader ? 1 : 0}`,
    `pinned:${pinnedCollapsed ? 1 : 0}:${canTogglePinnedWorkspaces ? 1 : 0}`,
  ];
  if (!pinnedCollapsed) {
    if (leadingPinnedWorkspace) parts.push(`leading:${leadingPinnedWorkspace.workspaceKey}`);
    for (const workspace of visiblePinnedWorkspaces) parts.push(workspace.workspaceKey);
  }
  for (const limited of limitedGroups) {
    parts.push(`group:${limited.group.bucket}:${limited.collapsed ? 1 : 0}`);
    if (limited.collapsed) continue;
    if (limited.leadingRow) parts.push(`leading:${limited.leadingRow.workspaceKey}`);
    for (const workspace of limited.visibleRows) parts.push(workspace.workspaceKey);
    if (limited.canToggle) parts.push("more");
  }
  for (const entry of archivedWorkspaces) parts.push(`archived:${entry.workspaceKey}`);
  return parts.join("|");
}

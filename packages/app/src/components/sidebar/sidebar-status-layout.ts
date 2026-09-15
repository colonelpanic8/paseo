import { useCallback, useMemo, useState } from "react";
import type { StatusGroup } from "@/hooks/sidebar-status-view-model";
import type { ArchivedWorkspaceEntry } from "@/hooks/use-archived-workspaces";
import type { SidebarWorkspaceEntry } from "@/hooks/use-sidebar-workspaces-list";
import { INITIAL_VISIBLE_ITEMS } from "@/components/sidebar/use-limited-sidebar-group";

/** One status group as the list is about to render it, limit already applied. */
export interface LimitedStatusGroup {
  group: StatusGroup;
  collapsed: boolean;
  visibleRows: SidebarWorkspaceEntry[];
  expanded: boolean;
  canToggle: boolean;
}

const NO_EXPANDED_BUCKETS: ReadonlySet<string> = new Set();

/**
 * Show-more state for every status group at once. It lives above the groups so
 * the list can describe the exact rows it is rendering in the settle signature;
 * a group that kept its own expansion would move its neighbors without the list
 * ever knowing.
 */
export function useLimitedStatusGroups(
  groups: StatusGroup[],
  collapsedStatusGroupKeys: ReadonlySet<string>,
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
        return {
          group,
          collapsed: collapsedStatusGroupKeys.has(group.bucket),
          visibleRows: expanded ? group.rows.slice() : group.rows.slice(0, INITIAL_VISIBLE_ITEMS),
          expanded,
          canToggle: group.rows.length > INITIAL_VISIBLE_ITEMS,
        };
      }),
    [collapsedStatusGroupKeys, expandedBuckets, groups],
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
  visiblePinnedWorkspaces,
  canTogglePinnedWorkspaces,
  limitedGroups,
  archivedWorkspaces,
}: {
  hasListHeader: boolean;
  pinnedCollapsed: boolean;
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
    for (const workspace of visiblePinnedWorkspaces) parts.push(workspace.workspaceKey);
  }
  for (const limited of limitedGroups) {
    parts.push(`group:${limited.group.bucket}:${limited.collapsed ? 1 : 0}`);
    if (limited.collapsed) continue;
    for (const workspace of limited.visibleRows) parts.push(workspace.workspaceKey);
    if (limited.canToggle) parts.push("more");
  }
  for (const entry of archivedWorkspaces) parts.push(`archived:${entry.workspaceKey}`);
  return parts.join("|");
}

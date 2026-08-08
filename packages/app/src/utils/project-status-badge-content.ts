import type { SidebarWorkspaceEntry } from "@/hooks/sidebar-workspaces-view-model";

type SidebarStatusBucket = SidebarWorkspaceEntry["statusBucket"];
export type ProjectStatusBadgeDotBucket = "failed" | "running";

export type ProjectStatusBadgeContent =
  | { kind: "alert" }
  | { kind: "dot"; bucket: ProjectStatusBadgeDotBucket };

/**
 * What the project status badge should render for a project's aggregate bucket, or null when
 * no badge should show at all. Kept as plain data (no React) so it's testable without JSDOM
 * or component mounting — see docs/testing.md's two test categories.
 *
 * Running is a dot like failed rather than its own glyph. The badge is 14pt;
 * anything with internal detail at that size loses to a solid disc, so the buckets separate
 * by color and — for running alone — by pulsing. Only needs_input earns a glyph, because
 * "someone must act" has to survive being the one amber state next to running.
 */
export function getProjectStatusBadgeContent(
  statusBucket: SidebarStatusBucket | null,
): ProjectStatusBadgeContent | null {
  if (statusBucket === "needs_input") {
    return { kind: "alert" };
  }
  if (statusBucket === "failed" || statusBucket === "running") {
    return { kind: "dot", bucket: statusBucket };
  }
  return null;
}

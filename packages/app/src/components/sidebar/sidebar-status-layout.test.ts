import { describe, expect, it } from "vitest";
import type { StatusGroup } from "@/hooks/sidebar-status-view-model";
import type { SidebarWorkspaceEntry } from "@/hooks/use-sidebar-workspaces-list";
import { buildStatusLayoutSignature, type LimitedStatusGroup } from "./sidebar-status-layout";

function makeWorkspace(id: string): SidebarWorkspaceEntry {
  return {
    workspaceKey: `srv:${id}`,
    serverId: "srv",
    workspaceId: id,
    projectViewKey: "project",
    projectName: "Project",
    projectKind: "git",
    workspaceKind: "worktree",
    name: id,
    workspaceDirectory: "",
    workspaceDirectoryLabel: "",
    title: null,
    currentBranch: null,
    statusBucket: "done",
    statusEnteredAt: null,
    lastUserMessageAt: null,
    activityAt: null,
    archivingAt: null,
    diffStat: null,
    prHint: null,
    archiveHasUncommittedChanges: null,
    archiveUnpushedCommitCount: null,
    scripts: [],
    hasRunningScripts: false,
    remoteUrl: null,
    providers: [],
  };
}

function makeGroup(
  bucket: StatusGroup["bucket"],
  workspaces: SidebarWorkspaceEntry[],
  collapsed = false,
): LimitedStatusGroup {
  return {
    group: { bucket, label: bucket, rows: workspaces },
    collapsed,
    visibleRows: workspaces,
    expanded: false,
    canToggle: false,
  };
}

function signatureFor(
  limitedGroups: LimitedStatusGroup[],
  overrides?: { pinnedCollapsed?: boolean },
) {
  return buildStatusLayoutSignature({
    hasListHeader: false,
    pinnedCollapsed: overrides?.pinnedCollapsed ?? false,
    visiblePinnedWorkspaces: [],
    canTogglePinnedWorkspaces: false,
    limitedGroups,
    archivedWorkspaces: [],
  });
}

describe("buildStatusLayoutSignature", () => {
  const running = makeWorkspace("running-one");
  const done = makeWorkspace("done-one");

  it("holds still when the same rows render in the same order", () => {
    const groups = () => [makeGroup("running", [running]), makeGroup("done", [done])];
    expect(signatureFor(groups())).toBe(signatureFor(groups()));
  });

  it("changes when a workspace switches status groups", () => {
    const before = signatureFor([makeGroup("running", [running, done]), makeGroup("done", [])]);
    const after = signatureFor([makeGroup("running", [running]), makeGroup("done", [done])]);
    expect(after).not.toBe(before);
  });

  it("changes when a group appears", () => {
    const before = signatureFor([makeGroup("done", [done])]);
    const after = signatureFor([makeGroup("running", [running]), makeGroup("done", [done])]);
    expect(after).not.toBe(before);
  });

  it("changes when rows are reordered inside a group", () => {
    const before = signatureFor([makeGroup("done", [running, done])]);
    const after = signatureFor([makeGroup("done", [done, running])]);
    expect(after).not.toBe(before);
  });

  it("changes when a group collapses, and ignores the rows it hides", () => {
    const expandedSignature = signatureFor([makeGroup("done", [running, done])]);
    const collapsedSignature = signatureFor([makeGroup("done", [running, done], true)]);
    expect(collapsedSignature).not.toBe(expandedSignature);
    expect(collapsedSignature).toBe(signatureFor([makeGroup("done", [running], true)]));
  });

  it("ignores pinned rows while the pinned section is collapsed", () => {
    const collapsed = buildStatusLayoutSignature({
      hasListHeader: false,
      pinnedCollapsed: true,
      visiblePinnedWorkspaces: [running],
      canTogglePinnedWorkspaces: false,
      limitedGroups: [],
      archivedWorkspaces: [],
    });
    expect(collapsed).toBe(signatureFor([], { pinnedCollapsed: true }));
  });
});

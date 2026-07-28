import type { SidebarWorkspaceEntry } from "@/hooks/use-sidebar-workspaces-list";
import type { WorkspaceTitleSource } from "@/hooks/use-settings";

export function resolveSidebarWorkspacePrimaryLabel(input: {
  workspace: Pick<
    SidebarWorkspaceEntry,
    "name" | "currentBranch" | "workspaceDirectory" | "workspaceKind"
  >;
  workspaceTitleSource: WorkspaceTitleSource;
}): string {
  if (input.workspaceTitleSource === "branch") {
    return input.workspace.currentBranch ?? input.workspace.name;
  }
  if (input.workspaceTitleSource === "worktree") {
    return resolveWorktreeSuffix(input.workspace) ?? input.workspace.name;
  }
  return input.workspace.name;
}

/**
 * The generated slug a worktree lives under — the `unkempt-alpacka` in
 * `<worktrees-root>/<hash>/unkempt-alpacka`. It is the name that shows up in shell
 * prompts and paths, so it is often what you are actually looking for in the
 * sidebar, and unlike the branch it stays stable across a rename.
 *
 * Only worktrees have one. Every other workspace kind keeps its normal name rather
 * than showing the last path segment of a checkout the user never sees as a slug.
 */
function resolveWorktreeSuffix(
  workspace: Pick<SidebarWorkspaceEntry, "workspaceDirectory" | "workspaceKind">,
): string | null {
  if (workspace.workspaceKind !== "worktree") {
    return null;
  }
  const directory = workspace.workspaceDirectory?.trim();
  if (!directory) {
    return null;
  }
  const suffix = directory
    .replace(/[/\\]+$/, "")
    .split(/[/\\]/)
    .pop();
  return suffix && suffix.length > 0 ? suffix : null;
}

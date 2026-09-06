import { stat } from "node:fs/promises";
import type { SessionOutboundMessage } from "@getpaseo/protocol/messages";
import type { PersistedWorkspaceRecord } from "../workspace-registry.js";

interface WorkspacePruningDependencies {
  listWorkspaces: () => Promise<PersistedWorkspaceRecord[]>;
  archiveWorkspace: (workspaceId: string) => Promise<void>;
}

interface WorkspacePruningOptions {
  projectId?: string;
  dryRun?: boolean;
}

type WorkspacePruningResult = Pick<
  Extract<SessionOutboundMessage, { type: "workspace.prune.response" }>["payload"],
  "workspaces" | "errors"
>;

async function directoryExists(directory: string): Promise<boolean> {
  try {
    return (await stat(directory)).isDirectory();
  } catch (error) {
    if (error instanceof Error && "code" in error) {
      if (error.code === "ENOENT" || error.code === "ENOTDIR") return false;
    }
    throw error;
  }
}

export async function pruneMissingWorkspaces(
  dependencies: WorkspacePruningDependencies,
  options: WorkspacePruningOptions,
): Promise<WorkspacePruningResult> {
  const result: WorkspacePruningResult = { workspaces: [], errors: [] };
  const workspaces = await dependencies.listWorkspaces();
  for (const workspace of workspaces) {
    if (workspace.archivedAt) continue;
    if (options.projectId !== undefined && workspace.projectId !== options.projectId) continue;
    const entry = { workspaceId: workspace.workspaceId, directory: workspace.cwd };
    try {
      if (await directoryExists(workspace.cwd)) continue;
      if (!options.dryRun) await dependencies.archiveWorkspace(workspace.workspaceId);
      result.workspaces.push(entry);
    } catch (error) {
      result.errors.push({
        ...entry,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return result;
}

import type { Command } from "commander";
import type { SessionOutboundMessage } from "@getpaseo/protocol/messages";
import { connectToDaemon, getDaemonHost } from "../../utils/client.js";
import type { CommandError, ListResult, OutputSchema } from "../../output/index.js";

type PrunedWorkspace = Extract<
  SessionOutboundMessage,
  { type: "workspace.prune.response" }
>["payload"]["workspaces"][number];

interface WorkspacePruneRow extends PrunedWorkspace {
  status: "would_archive" | "archived";
}

const workspacePruneSchema: OutputSchema<WorkspacePruneRow> = {
  idField: "workspaceId",
  columns: [
    { header: "WORKSPACE ID", field: "workspaceId", width: 20 },
    { header: "STATUS", field: "status", width: 14 },
    { header: "DIRECTORY", field: "directory", width: 42 },
  ],
};

export async function runPruneCommand(
  options: { host?: string; project?: string; dryRun?: boolean },
  _command: Command,
): Promise<ListResult<WorkspacePruneRow>> {
  const host = getDaemonHost({ host: options.host });
  const client = await connectToDaemon({ host: options.host }).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    throw {
      code: "DAEMON_NOT_RUNNING",
      message: `Cannot connect to daemon at ${host}: ${message}`,
    } satisfies CommandError;
  });
  try {
    const payload = await client.pruneWorkspaces({
      projectId: options.project,
      dryRun: options.dryRun,
    });
    if (payload.error) throw new Error(payload.error);
    if (payload.errors.length > 0) {
      const failures = payload.errors.map((entry) => `${entry.directory}: ${entry.error}`);
      throw {
        code: "WORKSPACE_PRUNE_FAILED",
        message: `Cleanup failed for ${payload.errors.length} workspace(s): ${failures.join("; ")}`,
        details: payload,
      } satisfies CommandError;
    }
    const status = payload.dryRun ? "would_archive" : "archived";
    return {
      type: "list",
      data: payload.workspaces.map((workspace) => ({
        workspaceId: workspace.workspaceId,
        directory: workspace.directory,
        status,
      })),
      schema: workspacePruneSchema,
    };
  } catch (error) {
    if (error && typeof error === "object" && "code" in error) throw error;
    const message = error instanceof Error ? error.message : String(error);
    throw { code: "WORKSPACE_PRUNE_FAILED", message } satisfies CommandError;
  } finally {
    await client.close().catch(() => undefined);
  }
}

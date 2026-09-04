import type { AgentAttachment } from "@getpaseo/protocol/messages";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";

function isLikelyWindowsPath(path: string): boolean {
  return /^[a-zA-Z]:\//.test(path);
}

function isChatHistoryTextAttachment(attachment: AgentAttachment): boolean {
  return attachment.type === "text" && attachment.contextKind === "chat_history";
}

export function getWorkspaceNamingAttachments(
  attachments: readonly AgentAttachment[],
): AgentAttachment[] {
  return attachments.filter((attachment) => !isChatHistoryTextAttachment(attachment));
}

export function remapDraftCwdToWorkspace(input: {
  cwd: string;
  sourceDirectory?: string | null;
  workspaceDirectory: string;
}): string {
  const cwd = input.cwd.trim();
  const sourceDirectory = input.sourceDirectory?.trim();
  const workspaceDirectory = input.workspaceDirectory.trim();
  if (!cwd || !sourceDirectory) {
    return workspaceDirectory;
  }
  const normalizedCwd = cwd.replace(/\\/g, "/").replace(/\/+$/, "");
  const normalizedSource = sourceDirectory.replace(/\\/g, "/").replace(/\/+$/, "");
  const compareCaseInsensitively =
    isLikelyWindowsPath(normalizedCwd) || isLikelyWindowsPath(normalizedSource);
  const comparableCwd = compareCaseInsensitively ? normalizedCwd.toLowerCase() : normalizedCwd;
  const comparableSource = compareCaseInsensitively
    ? normalizedSource.toLowerCase()
    : normalizedSource;
  if (comparableCwd === comparableSource) {
    return workspaceDirectory;
  }
  const relativePath = comparableCwd.startsWith(`${comparableSource}/`)
    ? normalizedCwd.slice(normalizedSource.length + 1)
    : "";
  if (!relativePath) {
    return workspaceDirectory;
  }
  const separator =
    workspaceDirectory.includes("\\") && !workspaceDirectory.includes("/") ? "\\" : "/";
  return [workspaceDirectory.replace(/[\\/]+$/, ""), ...relativePath.split("/")]
    .filter(Boolean)
    .join(separator);
}

export async function createNativeForkInWorkspace(input: {
  client: Pick<DaemonClient, "forkAgentNative">;
  agentId: string;
  boundaryMessageId: string;
  sourceCwd: string;
  sourceDirectory?: string | null;
  ensureWorkspace: (input: {
    cwd: string;
    prompt: string;
    attachments: AgentAttachment[];
    withInitialAgent: boolean;
  }) => Promise<{ id: string; workspaceDirectory: string }>;
  failureMessage: string;
}): Promise<{ agentId: string; workspaceId: string }> {
  const workspace = await input.ensureWorkspace({
    cwd: input.sourceCwd,
    prompt: "",
    attachments: [],
    withInitialAgent: false,
  });
  const forked = await input.client.forkAgentNative(input.agentId, {
    boundaryMessageId: input.boundaryMessageId,
    workspaceId: workspace.id,
    cwd: remapDraftCwdToWorkspace({
      cwd: input.sourceCwd,
      sourceDirectory: input.sourceDirectory,
      workspaceDirectory: workspace.workspaceDirectory,
    }),
  });
  if (!forked.forkedAgentId) {
    throw new Error(input.failureMessage);
  }
  return {
    agentId: forked.forkedAgentId,
    workspaceId: forked.forkedWorkspaceId ?? workspace.id,
  };
}

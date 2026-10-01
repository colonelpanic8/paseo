import { useCallback, useMemo } from "react";
import { i18n } from "@/i18n/i18next";
import { getHostRuntimeStore } from "@/runtime/host-runtime";
import { useSessionStore } from "@/stores/session-store";
import { hasClearableWorkspaceAttention } from "@/utils/clear-workspace-attention";

export interface ClearWorkspaceAttentionController {
  hasClearableAttention: boolean;
  clearAttention: () => Promise<void>;
}

export function useClearWorkspaceAttention({
  serverId,
  workspaceId,
}: {
  serverId: string;
  workspaceId: string;
}): ClearWorkspaceAttentionController {
  const hasClearableAttention = useSessionStore((state) => {
    const session = state.sessions[serverId];
    const workspace = session?.workspaces.get(workspaceId);
    const readyToReview = session?.workspaceAgentActivity.get(workspaceId)?.readyToReview === true;
    return hasClearableWorkspaceAttention({
      workspaceStatus: workspace?.status,
      readyToReview,
    });
  });

  const clearAttention = useCallback(async () => {
    if (!hasClearableAttention) {
      return;
    }
    const client = getHostRuntimeStore().getClient(serverId);
    if (!client) {
      throw new Error(i18n.t("workspace.terminal.hostDisconnected"));
    }
    await client.clearWorkspaceAttention(workspaceId);
  }, [hasClearableAttention, serverId, workspaceId]);

  return useMemo(
    () => ({ hasClearableAttention, clearAttention }),
    [clearAttention, hasClearableAttention],
  );
}

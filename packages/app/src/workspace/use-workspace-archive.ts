import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import {
  archivedWorkspacesQueryKey,
  beginArchivedWorkspaceTransition,
  settleArchivedWorkspaceTransition,
} from "@/hooks/use-archived-workspaces";
import { ARCHIVE_COLLAPSE_MS } from "@/components/sidebar/sidebar-motion";
import { getHostRuntimeStore } from "@/runtime/host-runtime";
import { useToast } from "@/contexts/toast-context";
import {
  confirmRiskyWorktreeArchive,
  DEFAULT_WORKTREE_ARCHIVE_WARNING_LABELS,
  type WorktreeArchiveWarningLabels,
} from "@/git/worktree-archive-warning";
import type { WorkspaceDescriptor } from "@/stores/session-store";
import { useWorkspaceLayoutStore } from "@/stores/workspace-layout-store";
import { buildWorkspaceTabPersistenceKey } from "@/workspace-tabs/model";
import { archiveWorkspaceOptimistically } from "@/workspace/workspace-archive";

function purgeArchivedWorkspaceState(input: { serverId: string; workspaceId: string }): void {
  const workspaceKey = buildWorkspaceTabPersistenceKey(input);
  if (workspaceKey) {
    useWorkspaceLayoutStore.getState().purgeWorkspace(workspaceKey);
  }
}

export interface ArchiveWorkspaceInput {
  serverId: string;
  workspaceId: string;
  workspaceKind: WorkspaceDescriptor["workspaceKind"];
  name: string;
  projectName: string;
  isDirty?: boolean | null;
  aheadOfOrigin?: number | null;
  diffStat?: { additions: number; deletions: number } | null;
  warningLabels?: WorktreeArchiveWarningLabels;
  onArchiveStarted: () => void;
  onSetHiding?: (hiding: boolean) => void;
}

export interface WorkspaceArchiveController {
  archive: () => void;
}

export function useWorkspaceArchive(input: ArchiveWorkspaceInput): WorkspaceArchiveController {
  const {
    serverId,
    workspaceId,
    workspaceKind,
    name,
    projectName,
    isDirty,
    aheadOfOrigin,
    diffStat,
    warningLabels = DEFAULT_WORKTREE_ARCHIVE_WARNING_LABELS,
    onArchiveStarted,
    onSetHiding,
  } = input;
  const { t } = useTranslation();
  const toast = useToast();
  const queryClient = useQueryClient();

  const archiveWorkspaceRecord = useCallback(async () => {
    const client = getHostRuntimeStore().getClient(serverId);
    if (!client) {
      toast.error(t("sidebar.workspace.toasts.hostDisconnected"));
      return;
    }
    onSetHiding?.(true);
    // Let the row collapse itself out of the list while it still owns its slot
    // (see sidebar-motion.ts) before anything is removed or inserted. The
    // collapse closes the gap on its own, so by the time this resolves the row
    // is a zero-height sliver and the removal has nothing left to animate; the
    // tail arrival is a separate animation that starts after this.
    await new Promise((resolve) => setTimeout(resolve, ARCHIVE_COLLAPSE_MS));
    const workspaceKey = `${serverId}:${workspaceId}`;
    await beginArchivedWorkspaceTransition({
      queryClient,
      entry: {
        workspaceKey,
        serverId,
        workspaceId,
        projectName,
        name,
        archivedAt: new Date(),
        phase: "archiving",
      },
    });
    try {
      onArchiveStarted();
      await archiveWorkspaceOptimistically({
        client,
        workspace: {
          serverId,
          workspaceId,
        },
      });
      purgeArchivedWorkspaceState({ serverId, workspaceId });
      settleArchivedWorkspaceTransition({
        queryClient,
        serverId,
        workspaceKey,
        outcome: "archived",
      });
      void queryClient.invalidateQueries({ queryKey: archivedWorkspacesQueryKey(serverId) });
    } catch (error) {
      settleArchivedWorkspaceTransition({
        queryClient,
        serverId,
        workspaceKey,
        outcome: "failed",
      });
      toast.error(
        error instanceof Error ? error.message : t("sidebar.workspace.toasts.archiveFailed"),
      );
    } finally {
      onSetHiding?.(false);
    }
  }, [
    name,
    onArchiveStarted,
    onSetHiding,
    projectName,
    queryClient,
    serverId,
    t,
    toast,
    workspaceId,
  ]);

  const archive = useCallback(() => {
    void (async () => {
      if (workspaceKind === "worktree") {
        const confirmed = await confirmRiskyWorktreeArchive(
          {
            workspaceName: name,
            isDirty,
            aheadOfOrigin,
            diffStat,
          },
          warningLabels,
        );
        if (!confirmed) {
          return;
        }
      }
      await archiveWorkspaceRecord();
    })();
  }, [
    aheadOfOrigin,
    archiveWorkspaceRecord,
    diffStat,
    isDirty,
    name,
    warningLabels,
    workspaceKind,
  ]);

  return {
    archive,
  };
}

import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useToast } from "@/contexts/toast-context";
import { useHostFeature } from "@/runtime/host-features";
import { getHostRuntimeStore } from "@/runtime/host-runtime";
import {
  resolveWorkspaceSnoozePresets,
  type WorkspaceSnoozePreset,
  type WorkspaceSnoozePresetId,
} from "@/workspace-snooze/model";
import { useCustomSnoozeStore } from "@/workspace-snooze/custom-snooze-store";

const PRESET_LABEL_KEYS: Record<WorkspaceSnoozePresetId, string> = {
  hour: "sidebar.workspace.actions.snoozeHour",
  evening: "sidebar.workspace.actions.snoozeEvening",
  tomorrow: "sidebar.workspace.actions.snoozeTomorrow",
  "next-week": "sidebar.workspace.actions.snoozeNextWeek",
};

export interface SidebarWorkspaceSnoozeActions {
  isSnoozed: boolean;
  presets: readonly (WorkspaceSnoozePreset & { label: string })[];
  customLabel: string;
  wakeLabel: string;
  onSnooze: (preset: WorkspaceSnoozePreset) => Promise<void> | void;
  onCustom: () => void;
  onWake: () => Promise<void> | void;
}

export function useWorkspaceSnoozeMenu(input: {
  serverId: string;
  workspaceId: string;
  // Effective sidebar state — decides between the preset list and "Wake".
  isSnoozed: boolean;
}): SidebarWorkspaceSnoozeActions | undefined {
  const { t } = useTranslation();
  const toast = useToast();
  const { serverId, workspaceId, isSnoozed } = input;
  // COMPAT(workspaceSnooze): added in v0.2.4, drop the gate when floor >= v0.2.4.
  // The single capability gate for the snooze UI — hosts without the feature
  // simply don't get the menu entries.
  const enabled = useHostFeature(serverId, "workspaceSnooze");

  // Preset times drift while the menu sits open, so onSnooze re-resolves by id
  // at click time; the labels rendered here are time-independent.
  const presets = useMemo(
    () =>
      resolveWorkspaceSnoozePresets(new Date()).map((preset) => ({
        id: preset.id,
        snoozedUntil: preset.snoozedUntil,
        label: t(PRESET_LABEL_KEYS[preset.id]),
      })),
    [t],
  );

  const onSnooze = useCallback(
    async (preset: WorkspaceSnoozePreset) => {
      const client = getHostRuntimeStore().getClient(serverId);
      if (!client) {
        toast.error(t("sidebar.workspace.toasts.hostDisconnected"));
        return;
      }
      const currentPreset =
        resolveWorkspaceSnoozePresets(new Date()).find((candidate) => candidate.id === preset.id) ??
        preset;
      toast.show(t("sidebar.workspace.toasts.snoozingWorkspace"), { durationMs: null });
      try {
        await client.setWorkspaceSnooze(workspaceId, currentPreset.snoozedUntil);
        toast.show(t("sidebar.workspace.toasts.snoozedWorkspace"), { variant: "success" });
      } catch (error) {
        toast.error(
          error instanceof Error
            ? error.message
            : t("sidebar.workspace.toasts.failedToSnoozeWorkspace"),
        );
      }
    },
    [serverId, t, toast, workspaceId],
  );

  const onWake = useCallback(async () => {
    const client = getHostRuntimeStore().getClient(serverId);
    if (!client) {
      toast.error(t("sidebar.workspace.toasts.hostDisconnected"));
      return;
    }
    toast.show(t("sidebar.workspace.toasts.wakingWorkspace"), { durationMs: null });
    try {
      await client.setWorkspaceSnooze(workspaceId, null);
      toast.show(t("sidebar.workspace.toasts.wokeWorkspace"), { variant: "success" });
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("sidebar.workspace.toasts.failedToWakeWorkspace"),
      );
    }
  }, [serverId, t, toast, workspaceId]);

  const onCustom = useCallback(() => {
    useCustomSnoozeStore.getState().open(serverId, workspaceId);
  }, [serverId, workspaceId]);

  if (!enabled) {
    return undefined;
  }
  return {
    isSnoozed,
    presets,
    customLabel: t("sidebar.workspace.actions.snoozeCustom"),
    wakeLabel: t("sidebar.workspace.actions.wake"),
    onSnooze,
    onCustom,
    onWake,
  };
}

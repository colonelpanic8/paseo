import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useToast } from "@/contexts/toast-context";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { useSessionStore } from "@/stores/session-store";
import {
  canSnoozeAgent,
  isAgentEffectivelySnoozed,
  resolveAgentSnoozePresets,
  type AgentSnoozePreset,
  type AgentSnoozePresetId,
} from "@/agent-snooze/model";
import type { WorkspaceTabSnoozeActions } from "@/screens/workspace/workspace-tab-menu";
import { useCustomSnoozeStore } from "@/agent-snooze/custom-snooze-store";

const PRESET_LABEL_KEYS: Record<AgentSnoozePresetId, string> = {
  hour: "workspace.tabs.menu.snoozeHour",
  evening: "workspace.tabs.menu.snoozeEvening",
  tomorrow: "workspace.tabs.menu.snoozeTomorrow",
  "next-week": "workspace.tabs.menu.snoozeNextWeek",
};

export function useAgentSnoozeMenu(
  serverId: string,
  agentId: string | null,
): WorkspaceTabSnoozeActions | undefined {
  const { t } = useTranslation();
  const toast = useToast();
  const client = useHostRuntimeClient(serverId);
  const isConnected = useHostRuntimeIsConnected(serverId);
  const agent = useSessionStore((state) => {
    if (!agentId) {
      return undefined;
    }
    const session = state.sessions[serverId];
    return session?.agents?.get(agentId) ?? session?.agentDetails?.get(agentId);
  });
  const nowMs = Date.now();
  const isSnoozed = agent ? isAgentEffectivelySnoozed(agent, nowMs) : false;
  const presets = useMemo(
    () =>
      resolveAgentSnoozePresets(new Date()).map((preset) => ({
        id: preset.id,
        snoozedUntil: preset.snoozedUntil,
        label: t(PRESET_LABEL_KEYS[preset.id]),
      })),
    [t],
  );

  const onSnooze = useCallback(
    async (preset: AgentSnoozePreset) => {
      if (!client || !isConnected || !agentId) {
        toast.error(t("workspace.terminal.hostDisconnected"));
        return;
      }
      const currentPresets = resolveAgentSnoozePresets(new Date());
      const currentPreset =
        currentPresets.find((candidate) => candidate.id === preset.id) ?? preset;
      toast.show(t("workspace.tabs.toasts.snoozingAgent"), { durationMs: null });
      try {
        await client.updateAgent(agentId, {
          snoozeUntil: currentPreset.snoozedUntil,
        });
        toast.show(t("workspace.tabs.toasts.snoozedAgent"), { variant: "success" });
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : t("workspace.tabs.toasts.failedToSnoozeAgent"),
        );
      }
    },
    [agentId, client, isConnected, t, toast],
  );

  const onWake = useCallback(async () => {
    if (!client || !isConnected || !agentId) {
      toast.error(t("workspace.terminal.hostDisconnected"));
      return;
    }
    toast.show(t("workspace.tabs.toasts.wakingAgent"), { durationMs: null });
    try {
      await client.updateAgent(agentId, { snoozeUntil: null });
      toast.show(t("workspace.tabs.toasts.wokeAgent"), { variant: "success" });
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : t("workspace.tabs.toasts.failedToWakeAgent"),
      );
    }
  }, [agentId, client, isConnected, t, toast]);
  const onCustom = useCallback(() => {
    if (!agentId) {
      return;
    }
    useCustomSnoozeStore.getState().open(serverId, agentId);
  }, [agentId, serverId]);

  if (!agent || agent.archivedAt) {
    return undefined;
  }
  return {
    isSnoozed,
    disabled: !isConnected || (!isSnoozed && !canSnoozeAgent(agent, nowMs)),
    presets,
    customLabel: t("workspace.tabs.menu.snoozeCustom"),
    wakeLabel: t("workspace.tabs.menu.wakeNow"),
    onSnooze,
    onCustom,
    onWake,
  };
}

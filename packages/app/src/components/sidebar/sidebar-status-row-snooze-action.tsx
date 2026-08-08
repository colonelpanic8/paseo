import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Text, type PressableStateCallbackType } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { Clock } from "lucide-react-native";
import { isWeb } from "@/constants/platform";
import type { Theme } from "@/styles/theme";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { SidebarWorkspaceSnoozeActions } from "@/workspace-snooze/use-workspace-snooze-menu";

const SNOOZE_ICON_SIZE = 14;

const foregroundMutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
// The sidebar's established blue, matching the status icons in sidebar-status-list.
const blueColorMapping = (theme: Theme) => ({ color: theme.colors.palette.blue[500] });
// Hover intensifies: darker blue on a light surface, brighter blue on a dark one.
const blueHoveredColorMapping = (theme: Theme) => ({
  color:
    theme.colorScheme === "light" ? theme.colors.palette.blue[600] : theme.colors.palette.blue[400],
});

const ThemedClock = withUnistyles(Clock);

const clockLeadingIcon = (
  <ThemedClock size={SNOOZE_ICON_SIZE} uniProps={foregroundMutedColorMapping} />
);

/**
 * Snooze affordance beside the archive action. Normally icon-only — two
 * labelled actions would crowd the meta line — but a snoozed workspace also
 * spells out when it wakes and how long is left, because that is the row's only
 * sign it is asleep. The countdown ticks with the shared minute clock that
 * useWorkspaceSnoozeMenu subscribes to.
 */
export function SidebarStatusRowSnoozeAction({
  workspaceKey,
  snooze,
}: {
  workspaceKey: string;
  snooze: SidebarWorkspaceSnoozeActions;
}) {
  const { t } = useTranslation();
  const { onWake, snoozeChipLabel, snoozedUntilLabel } = snooze;
  const handleWake = useCallback(() => {
    void onWake();
  }, [onWake]);
  const renderTrigger = useCallback(
    ({ hovered = false }: { hovered?: boolean }) => (
      <>
        <ThemedClock
          size={SNOOZE_ICON_SIZE}
          uniProps={hovered ? blueHoveredColorMapping : blueColorMapping}
        />
        {snoozeChipLabel ? (
          <Text numberOfLines={1} style={getTriggerTextStyle(hovered)}>
            {snoozeChipLabel}
          </Text>
        ) : null}
      </>
    ),
    [snoozeChipLabel],
  );

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        hitSlop={8}
        style={triggerStyle}
        // The row itself is a <button> on web; a nested button is invalid HTML.
        accessibilityRole={isWeb ? undefined : "button"}
        accessibilityLabel={snoozedUntilLabel ?? t("sidebar.workspace.actions.snooze")}
        testID="sidebar-status-row-snooze-action"
      >
        {renderTrigger}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" width={220}>
        {snooze.isSnoozed ? (
          <>
            {snoozedUntilLabel ? (
              <DropdownMenuLabel testID={`sidebar-status-row-snoozed-until-${workspaceKey}`}>
                {snoozedUntilLabel}
              </DropdownMenuLabel>
            ) : null}
            <DropdownMenuItem
              testID={`sidebar-status-row-wake-${workspaceKey}`}
              leading={clockLeadingIcon}
              onSelect={handleWake}
            >
              {snooze.wakeLabel}
            </DropdownMenuItem>
          </>
        ) : (
          <>
            {snooze.presets.map((preset) => (
              <SnoozePresetItem
                key={preset.id}
                preset={preset}
                workspaceKey={workspaceKey}
                onSnooze={snooze.onSnooze}
              />
            ))}
            <DropdownMenuItem
              testID={`sidebar-status-row-snooze-custom-${workspaceKey}`}
              leading={clockLeadingIcon}
              onSelect={snooze.onCustom}
            >
              {snooze.customLabel}
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function SnoozePresetItem({
  preset,
  workspaceKey,
  onSnooze,
}: {
  preset: SidebarWorkspaceSnoozeActions["presets"][number];
  workspaceKey: string;
  onSnooze: SidebarWorkspaceSnoozeActions["onSnooze"];
}) {
  const handleSelect = useCallback(() => {
    void onSnooze(preset);
  }, [onSnooze, preset]);

  return (
    <DropdownMenuItem
      testID={`sidebar-status-row-snooze-${preset.id}-${workspaceKey}`}
      leading={clockLeadingIcon}
      onSelect={handleSelect}
    >
      {preset.label}
    </DropdownMenuItem>
  );
}

function triggerStyle({ hovered = false }: PressableStateCallbackType & { hovered?: boolean }) {
  return [styles.trigger, hovered && styles.triggerHovered];
}

function getTriggerTextStyle(hovered: boolean) {
  return hovered ? [styles.triggerText, styles.triggerTextHovered] : styles.triggerText;
}

const styles = StyleSheet.create((theme) => ({
  trigger: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    padding: 2,
    borderRadius: 4,
  },
  triggerHovered: {
    backgroundColor: theme.colors.surface2,
  },
  triggerText: {
    color: theme.colors.palette.blue[500],
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.normal,
    lineHeight: 16,
  },
  triggerTextHovered: {
    color:
      theme.colorScheme === "light"
        ? theme.colors.palette.blue[600]
        : theme.colors.palette.blue[400],
  },
}));

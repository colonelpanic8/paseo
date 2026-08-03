import {
  getCommandShortcutBindingId,
  getCommandShortcutIdFromBindingId,
} from "@/keyboard/keyboard-shortcuts";
import type { CommandCenterContribution } from "./contributions";

export type CommandShortcutSettingsGroup = "models" | "thinking";

export interface CommandShortcutSettingsRow {
  shortcutId: string;
  bindingId: string;
  group: CommandShortcutSettingsGroup;
  label: string;
  combo: string | undefined;
  available: boolean;
}

function getGroup(shortcutId: string): CommandShortcutSettingsGroup | null {
  if (shortcutId.startsWith("models:")) return "models";
  if (shortcutId.startsWith("thinking:")) return "thinking";
  return null;
}

function fallbackLabel(shortcutId: string, group: CommandShortcutSettingsGroup): string {
  const target = shortcutId.slice(group.length + 1);
  if (group === "thinking") return target;
  const separator = target.indexOf(":");
  if (separator < 0) return target;
  return `${target.slice(0, separator)} · ${target.slice(separator + 1)}`;
}

function contributionLabel(contribution: CommandCenterContribution): string | null {
  if (contribution.presentation.kind !== "choice") return null;
  return contribution.presentation.path.slice(1).join(" · ");
}

export function buildCommandShortcutSettingsRows(
  catalog: readonly CommandCenterContribution[],
  activeContributions: readonly CommandCenterContribution[],
  overrides: Readonly<Record<string, string>>,
): CommandShortcutSettingsRow[] {
  const contributionsByShortcutId = new Map<string, CommandCenterContribution[]>();
  for (const contribution of catalog) {
    if (!contribution.shortcutId || !getGroup(contribution.shortcutId)) continue;
    const matches = contributionsByShortcutId.get(contribution.shortcutId) ?? [];
    matches.push(contribution);
    contributionsByShortcutId.set(contribution.shortcutId, matches);
  }

  const activeCounts = new Map<string, number>();
  for (const contribution of activeContributions) {
    if (!contribution.shortcutId) continue;
    activeCounts.set(contribution.shortcutId, (activeCounts.get(contribution.shortcutId) ?? 0) + 1);
  }

  const shortcutIds = new Set(contributionsByShortcutId.keys());
  for (const bindingId of Object.keys(overrides)) {
    const shortcutId = getCommandShortcutIdFromBindingId(bindingId);
    if (shortcutId && getGroup(shortcutId)) shortcutIds.add(shortcutId);
  }

  return [...shortcutIds].flatMap((shortcutId) => {
    const group = getGroup(shortcutId);
    if (!group) return [];
    const matches = contributionsByShortcutId.get(shortcutId) ?? [];
    const available = activeCounts.get(shortcutId) === 1;
    const bindingId = getCommandShortcutBindingId(shortcutId);
    return [
      {
        shortcutId,
        bindingId,
        group,
        label:
          (matches.length === 1 ? contributionLabel(matches[0]) : null) ??
          fallbackLabel(shortcutId, group),
        combo: overrides[bindingId],
        available,
      },
    ];
  });
}

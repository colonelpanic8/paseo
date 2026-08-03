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
  if (shortcutId.startsWith("models:") && shortcutId.slice("models:".length).includes(":")) {
    return "models";
  }
  if (shortcutId.startsWith("thinking:") && shortcutId.length > "thinking:".length) {
    return "thinking";
  }
  return null;
}

function fallbackLabel(shortcutId: string, group: CommandShortcutSettingsGroup): string {
  const target = shortcutId.slice(group.length + 1);
  if (group === "thinking") return target === "top" ? "Top" : target;
  const separator = target.indexOf(":");
  return `${target.slice(0, separator)} · ${target.slice(separator + 1)}`;
}

function contributionLabel(contribution: CommandCenterContribution): string | null {
  if (contribution.presentation.kind !== "choice") return null;
  return contribution.presentation.path.slice(1).join(" · ");
}

function resolveLabel(
  shortcutId: string,
  group: CommandShortcutSettingsGroup,
  matches: readonly CommandCenterContribution[],
): string {
  if (shortcutId === "thinking:top") return "Top";
  const labels = new Set(matches.flatMap((match) => contributionLabel(match) ?? []));
  if (labels.size === 1) return [...labels][0];
  return fallbackLabel(shortcutId, group);
}

export function buildCommandShortcutSettingsRows(
  contributions: readonly CommandCenterContribution[],
  overrides: Readonly<Record<string, string>>,
): CommandShortcutSettingsRow[] {
  const contributionsByShortcutId = new Map<string, CommandCenterContribution[]>();
  for (const contribution of contributions) {
    if (!contribution.shortcutId || !getGroup(contribution.shortcutId)) continue;
    const matches = contributionsByShortcutId.get(contribution.shortcutId) ?? [];
    matches.push(contribution);
    contributionsByShortcutId.set(contribution.shortcutId, matches);
  }

  const shortcutIds = new Set(contributionsByShortcutId.keys());
  for (const bindingId of Object.keys(overrides)) {
    const shortcutId = getCommandShortcutIdFromBindingId(bindingId);
    if (shortcutId && getGroup(shortcutId)) shortcutIds.add(shortcutId);
  }

  const rows = [...shortcutIds].flatMap((shortcutId): CommandShortcutSettingsRow[] => {
    const group = getGroup(shortcutId);
    if (!group) return [];
    const matches = contributionsByShortcutId.get(shortcutId) ?? [];
    const bindingId = getCommandShortcutBindingId(shortcutId);
    return [
      {
        shortcutId,
        bindingId,
        group,
        label: resolveLabel(shortcutId, group, matches),
        combo: overrides[bindingId],
        available: matches.length > 0,
      },
    ];
  });

  return rows.sort((left, right) => {
    if (left.group !== right.group) return left.group === "models" ? -1 : 1;
    const labelDelta = left.label.localeCompare(right.label);
    return labelDelta !== 0 ? labelDelta : left.shortcutId.localeCompare(right.shortcutId);
  });
}

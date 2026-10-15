import type { AgentFeature, AgentFeatureToggle } from "../agent-sdk-types.js";

import { z } from "zod";

export const CodexServiceTierSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
});
export type CodexServiceTier = z.infer<typeof CodexServiceTierSchema>;

function buildCodexSpeedFeature(tiers: CodexServiceTier[], value: string): AgentFeature[] {
  if (tiers.length === 0) return [];
  return [
    {
      type: "select",
      id: "service_tier",
      label: "Speed",
      description: "Choose processing speed. Faster tiers increase usage.",
      tooltip: "Select speed",
      icon: "zap",
      desktopTrigger: "icon",
      value,
      options: [
        { id: "default", label: "Normal", isDefault: true },
        ...tiers.map((tier) => ({ id: tier.id, label: tier.name })),
      ],
    },
  ];
}

export const CODEX_PLAN_MODE_FEATURE: Omit<AgentFeatureToggle, "value"> = {
  type: "toggle",
  id: "plan_mode",
  label: "Plan",
  description: "Switch Codex into planning-only collaboration mode",
  tooltip: "Toggle plan mode",
  icon: "list-todo",
};

export const CODEX_CONTEXT_NOTES_FEATURE: Omit<AgentFeatureToggle, "value"> = {
  type: "toggle",
  id: "context_notes",
  label: "Notes",
  description: "Keep notes across context windows (experimental)",
  tooltip: "Toggle context notes",
  icon: "notebook-pen",
};

export function buildCodexFeatures(input: {
  serviceTiers: CodexServiceTier[];
  serviceTier: string;
  planModeEnabled: boolean;
  contextNotesEnabled: boolean;
  planModeAvailable?: boolean;
}): AgentFeature[] {
  const features = buildCodexSpeedFeature(input.serviceTiers, input.serviceTier);
  if (input.planModeAvailable !== false) {
    features.push({ ...CODEX_PLAN_MODE_FEATURE, value: input.planModeEnabled });
  }
  features.push({ ...CODEX_CONTEXT_NOTES_FEATURE, value: input.contextNotesEnabled });
  return features;
}

export function readCodexServiceTier(values: Record<string, unknown> | undefined): string | null {
  const tier = values?.service_tier;
  if (typeof tier === "string") return tier;
  // COMPAT(codexFastPreference): added in v0.10.0, remove after 2027-03-29 once saved Fast preferences have migrated.
  return values?.fast_mode ? "fast" : null;
}

import type { AgentFeature, AgentModelDefinition } from "@getpaseo/protocol/agent-types";
import { i18n } from "@/i18n/i18next";

export type ExplainedAgentControl = "mode" | "model" | "thinking";
export type FeatureHighlightColor = "blue" | "default" | "green" | "yellow";
export type AgentControlHintKey =
  | "agentControls.hints.thinking"
  | "agentControls.hints.model"
  | "agentControls.hints.mode";

export function getAgentControlHintKey(selector: ExplainedAgentControl): AgentControlHintKey {
  switch (selector) {
    case "thinking":
      return "agentControls.hints.thinking";
    case "model":
      return "agentControls.hints.model";
    case "mode":
      return "agentControls.hints.mode";
    default:
      throw new Error("unreachable");
  }
}

export function normalizeModelId(modelId: string | null | undefined): string | null {
  const normalized = typeof modelId === "string" ? modelId.trim() : "";
  if (!normalized) {
    return null;
  }
  return normalized;
}

export function getFeatureTooltip(feature: Pick<AgentFeature, "label" | "tooltip">): string {
  return feature.tooltip ?? feature.label;
}

export function getFeatureHighlightColor(featureId: string): FeatureHighlightColor {
  switch (featureId) {
    case "fast_mode":
      return "yellow";
    case "auto_accept":
      return "green";
    case "plan_mode":
      return "blue";
    default:
      return "default";
  }
}

interface ControlLabelInput {
  id: string;
  label?: string | null;
}

function sentenceCase(value: string): string {
  if (!value) {
    return value;
  }
  return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
}

function splitCompactLabel(value: string, splitHyphen: boolean): string {
  const separatorPattern = splitHyphen ? /[_-]+/g : /_+/g;

  return value
    .replace(separatorPattern, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim();
}

function formatControlLabel(option: ControlLabelInput, splitHyphen: boolean): string {
  const rawLabel = (option.label ?? option.id).trim();
  return sentenceCase(splitCompactLabel(rawLabel, splitHyphen));
}

export function formatAgentModeLabel(mode: ControlLabelInput): string {
  return formatControlLabel(mode, mode.label == null);
}

export function formatThinkingOptionLabel(option: ControlLabelInput): string {
  const rawLabel = (option.label ?? option.id).trim();
  const compactId = option.id.replace(/[\s_-]+/g, "").toLowerCase();
  const compactLabel = rawLabel.replace(/[\s_-]+/g, "").toLowerCase();

  if (compactId === "xhigh" || compactLabel === "xhigh") {
    return i18n.t("agentControls.thinking.extraHigh");
  }

  return formatControlLabel(option, true);
}

function findModelById(
  models: AgentModelDefinition[] | null,
  modelId: string | null,
): AgentModelDefinition | null {
  if (!models || !modelId) {
    return null;
  }
  return models.find((model) => model.id === modelId) ?? null;
}

function getFallbackModel(models: AgentModelDefinition[] | null): AgentModelDefinition | null {
  return models?.find((model) => model.isDefault) ?? models?.[0] ?? null;
}

function resolvePreferredModelId(
  runtimeSelectedModel: AgentModelDefinition | null,
  normalizedConfiguredModelId: string | null,
  normalizedRuntimeModelId: string | null,
): string | null {
  return runtimeSelectedModel?.id ?? normalizedConfiguredModelId ?? normalizedRuntimeModelId;
}

function pickSelectedModel(
  models: AgentModelDefinition[] | null,
  preferredModelId: string | null,
  fallbackModel: AgentModelDefinition | null,
): AgentModelDefinition | null {
  if (!models || !preferredModelId) {
    return fallbackModel;
  }
  return findModelById(models, preferredModelId) ?? fallbackModel;
}

function resolveThinkingId(
  explicitThinkingOptionId: string | null | undefined,
  selectedModel: AgentModelDefinition | null,
): string | null {
  if (explicitThinkingOptionId && explicitThinkingOptionId !== "default") {
    return explicitThinkingOptionId;
  }
  return selectedModel?.defaultThinkingOptionId ?? null;
}

/**
 * Which thinking id to *display* for an agent, as opposed to which one the
 * selector should mark as chosen.
 *
 * `effectiveThinkingOptionId` is the daemon's runtime-preferring value. The
 * `undefined` / `null` distinction is load-bearing: `undefined` means the daemon
 * never sent the field (pre-`effectiveThinkingOptionId` builds), so the
 * configured value is the best information available. An explicit `null` means
 * the runtime reported no thinking option, and the model default is the right
 * answer even when something is configured.
 */
function resolveDisplayThinkingSource(source: {
  thinkingOptionId?: string | null;
  effectiveThinkingOptionId?: string | null;
}): string | null | undefined {
  return source.effectiveThinkingOptionId !== undefined
    ? source.effectiveThinkingOptionId
    : source.thinkingOptionId;
}

type ThinkingOption = NonNullable<AgentModelDefinition["thinkingOptions"]>[number];

function resolveEffectiveThinking(
  thinkingOptions: ThinkingOption[] | null,
  resolvedThinkingId: string | null,
): ThinkingOption | null {
  const selectedThinking =
    thinkingOptions?.find((option) => option.id === resolvedThinkingId) ?? null;
  return selectedThinking ?? thinkingOptions?.[0] ?? null;
}

function resolveModelDisplay(
  selectedModel: AgentModelDefinition | null,
  preferredModelId: string | null,
  fallbackModel: AgentModelDefinition | null,
  unknownModelLabel: string,
): { activeModelId: string | null; displayModel: string } {
  return {
    activeModelId: selectedModel?.id ?? preferredModelId ?? null,
    displayModel:
      selectedModel?.label ?? preferredModelId ?? fallbackModel?.label ?? unknownModelLabel,
  };
}

function resolveThinkingDisplay(
  effectiveThinking: ThinkingOption | null,
  selectedThinkingId: string | null,
  unknownThinkingLabel: string,
): string {
  if (effectiveThinking) {
    return formatThinkingOptionLabel(effectiveThinking);
  }

  if (selectedThinkingId) {
    return formatThinkingOptionLabel({ id: selectedThinkingId });
  }

  return unknownThinkingLabel;
}

export function resolveAgentModelSelection(input: {
  models: AgentModelDefinition[] | null;
  runtimeModelId: string | null | undefined;
  configuredModelId: string | null | undefined;
  explicitThinkingOptionId: string | null | undefined;
  /** Daemon-computed runtime-preferring thinking id; drives display only. */
  effectiveThinkingOptionId?: string | null;
}) {
  const { models, runtimeModelId, configuredModelId, explicitThinkingOptionId } = input;
  const normalizedRuntimeModelId = normalizeModelId(runtimeModelId);
  const normalizedConfiguredModelId = normalizeModelId(configuredModelId);

  const runtimeSelectedModel = findModelById(models, normalizedRuntimeModelId);
  const preferredModelId = resolvePreferredModelId(
    runtimeSelectedModel,
    normalizedConfiguredModelId,
    normalizedRuntimeModelId,
  );
  const fallbackModel = getFallbackModel(models);
  const selectedModel = pickSelectedModel(models, preferredModelId, fallbackModel);

  const { activeModelId, displayModel } = resolveModelDisplay(
    selectedModel,
    preferredModelId,
    fallbackModel,
    i18n.t("agentControls.model.unknown"),
  );

  const thinkingOptions = selectedModel?.thinkingOptions ?? null;

  // Selection state: what the selector marks as chosen, and what a subsequent
  // mutation is relative to. Reads the configured value only, so opening the
  // dropdown never shows the runtime value as the user's choice.
  const resolvedThinkingId = resolveThinkingId(explicitThinkingOptionId, selectedModel);
  const effectiveThinking = resolveEffectiveThinking(thinkingOptions, resolvedThinkingId);
  const selectedThinkingId = effectiveThinking?.id ?? null;

  // Display state: what the chip reads out — prefers what the runtime reports.
  // A runtime-reported id outside the model's catalog must not fall back to the
  // first option — that would read out a level the agent is not using; it is
  // formatted verbatim by resolveThinkingDisplay instead. Only when display
  // resolves to the same id as the selection does it mirror the selection's
  // fallback, so the chip and the dropdown checkmark agree.
  const resolvedDisplayThinkingId = resolveThinkingId(
    resolveDisplayThinkingSource({
      thinkingOptionId: explicitThinkingOptionId,
      effectiveThinkingOptionId: input.effectiveThinkingOptionId,
    }),
    selectedModel,
  );
  const displayThinkingOption =
    thinkingOptions?.find((option) => option.id === resolvedDisplayThinkingId) ??
    (resolvedDisplayThinkingId === resolvedThinkingId ? effectiveThinking : null);
  const displayThinkingId = displayThinkingOption?.id ?? resolvedDisplayThinkingId;
  const displayThinking = resolveThinkingDisplay(
    displayThinkingOption,
    displayThinkingId,
    i18n.t("agentControls.thinking.unknown"),
  );

  return {
    selectedModel,
    activeModelId,
    displayModel,
    thinkingOptions,
    selectedThinkingId,
    displayThinkingId,
    displayThinking,
  };
}

/**
 * Everything needed to say what model and thinking level an agent is *actually*
 * running. Structurally satisfied by `Agent`-shaped records and by subagent rows.
 */
export interface AgentModelDisplaySource {
  /** Configured model id (`Agent.model`). */
  model?: string | null;
  /** Runtime-reported model id (`Agent.runtimeInfo.model`). */
  runtimeModelId?: string | null;
  /** Configured thinking option id (`Agent.thinkingOptionId`). */
  thinkingOptionId?: string | null;
  /** Daemon-computed runtime-preferring thinking id (`Agent.effectiveThinkingOptionId`). */
  effectiveThinkingOptionId?: string | null;
}

/** Projects an `Agent`-shaped record onto `AgentModelDisplaySource` for store selectors. */
export function pickAgentModelDisplaySource(
  agent: {
    model?: string | null;
    runtimeInfo?: { model?: string | null } | null;
    thinkingOptionId?: string | null;
    effectiveThinkingOptionId?: string | null;
  } | null,
): AgentModelDisplaySource {
  return {
    model: agent?.model ?? null,
    runtimeModelId: agent?.runtimeInfo?.model ?? null,
    thinkingOptionId: agent?.thinkingOptionId ?? null,
    effectiveThinkingOptionId: agent?.effectiveThinkingOptionId,
  };
}

export interface AgentModelDisplay {
  /** Resolved model id, or `null` when the agent has not reported one. */
  modelId: string | null;
  /** Human label from the providers snapshot, falling back to the raw model id. */
  modelLabel: string | null;
  thinkingOptionId: string | null;
  thinkingLabel: string | null;
}

export const UNKNOWN_AGENT_MODEL_DISPLAY: AgentModelDisplay = {
  modelId: null,
  modelLabel: null,
  thinkingOptionId: null,
  thinkingLabel: null,
};

/**
 * Read-only counterpart to `resolveAgentModelSelection`.
 *
 * Two deliberate differences. Every field is nullable, so callers render nothing
 * rather than an "Unknown" placeholder. And there is no provider-default fallback:
 * these surfaces claim what the agent *is* running, so an agent that reports no
 * model gets no label instead of the provider's default, which would be a guess.
 * An unrecognized id is kept verbatim — the raw id is still true.
 */
export function resolveAgentModelDisplay(input: {
  models: AgentModelDefinition[] | null;
  source: AgentModelDisplaySource | null | undefined;
}): AgentModelDisplay {
  const { models, source } = input;
  if (!source) {
    return UNKNOWN_AGENT_MODEL_DISPLAY;
  }

  const normalizedRuntimeModelId = normalizeModelId(source.runtimeModelId);
  const normalizedConfiguredModelId = normalizeModelId(source.model);
  // Runtime wins verbatim even when the id is not in the catalog: substituting
  // the configured model for an unrecognized runtime id would assert a model the
  // agent is not running, which is the misreport this surface exists to avoid.
  const preferredModelId = normalizedRuntimeModelId ?? normalizedConfiguredModelId;
  const selectedModel = findModelById(models, preferredModelId);
  const modelId = selectedModel?.id ?? preferredModelId;

  const thinkingOptionId = resolveThinkingId(resolveDisplayThinkingSource(source), selectedModel);
  const thinkingOption =
    selectedModel?.thinkingOptions?.find((option) => option.id === thinkingOptionId) ?? null;

  return {
    modelId,
    modelLabel: selectedModel?.label ?? modelId,
    thinkingOptionId,
    thinkingLabel: resolveDisplayThinkingLabel(thinkingOption, thinkingOptionId),
  };
}

function resolveDisplayThinkingLabel(
  thinkingOption: Parameters<typeof formatThinkingOptionLabel>[0] | null,
  thinkingOptionId: string | null,
): string | null {
  if (thinkingOption) {
    return formatThinkingOptionLabel(thinkingOption);
  }
  return thinkingOptionId ? formatThinkingOptionLabel({ id: thinkingOptionId }) : null;
}

/** Joins the resolved model and thinking labels into one muted meta string. */
export function formatAgentModelDisplayMeta(display: AgentModelDisplay): string | null {
  const parts = [display.modelLabel, display.thinkingLabel].filter(
    (part): part is string => typeof part === "string" && part.length > 0,
  );
  return parts.length > 0 ? parts.join(" · ") : null;
}

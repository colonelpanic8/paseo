import { describe, expect, it } from "vitest";
import type {
  ProviderSelectionModelRow,
  ProviderSelectorProvider,
} from "@/provider-selection/provider-selection";
import {
  buildAllModelsListItems,
  countAllModels,
  type ModelBrowserListItem,
} from "./model-browser-rows";

function row(provider: string, providerLabel: string, modelId: string): ProviderSelectionModelRow {
  return {
    favoriteKey: `${provider}:${modelId}`,
    provider,
    providerLabel,
    modelId,
    modelLabel: modelId,
    description: `${modelId} description`,
  };
}

function modelsProvider(id: string, label: string, modelIds: string[]): ProviderSelectorProvider {
  return {
    id,
    label,
    modelSelection: { kind: "models", rows: modelIds.map((modelId) => row(id, label, modelId)) },
  };
}

function keysOf(items: ModelBrowserListItem[]): string[] {
  return items.map((item) => item.key);
}

const codex = modelsProvider("codex", "Codex", ["gpt-5.4", "gpt-5.4-mini"]);
const claude = modelsProvider("claude", "Claude Code", ["opus-5", "haiku-4.5"]);

describe("buildAllModelsListItems", () => {
  it("groups every provider under its own heading", () => {
    const items = buildAllModelsListItems({ providers: [codex, claude], normalizedQuery: "" });

    expect(keysOf(items)).toEqual([
      "heading:provider:codex",
      "model:codex:gpt-5.4",
      "model:codex:gpt-5.4-mini",
      "heading:provider:claude",
      "model:claude:opus-5",
      "model:claude:haiku-4.5",
    ]);
  });

  it("collapses groups into one provider-qualified ranked run while searching", () => {
    const items = buildAllModelsListItems({
      providers: [codex, claude],
      normalizedQuery: "opus",
    });

    expect(keysOf(items)).toEqual(["model:claude:opus-5"]);
    expect(items[0]).toMatchObject({ showProvider: true });
  });

  it("keeps loading and failed providers visible as status headings", () => {
    const items = buildAllModelsListItems({
      providers: [
        codex,
        { id: "pi", label: "Pi", modelSelection: { kind: "loading" } },
        { id: "opencode", label: "OpenCode", modelSelection: { kind: "error", message: "boom" } },
      ],
      normalizedQuery: "",
    });

    expect(items).toContainEqual({
      kind: "heading",
      key: "heading:provider:pi",
      label: "Pi",
      providerId: "pi",
      status: "loading",
    });
    expect(items).toContainEqual({
      kind: "heading",
      key: "heading:provider:opencode",
      label: "OpenCode",
      providerId: "opencode",
      status: "error",
    });
  });
});

describe("countAllModels", () => {
  it("counts models across providers and ignores providers with no list yet", () => {
    expect(
      countAllModels([
        codex,
        claude,
        { id: "pi", label: "Pi", modelSelection: { kind: "loading" } },
      ]),
    ).toBe(4);
  });
});

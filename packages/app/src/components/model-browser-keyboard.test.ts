import { describe, expect, it } from "vitest";
import type { ProviderSelectionModelRow } from "@/provider-selection/provider-selection";
import { moveModelHighlight, resolveModelSubmitRow } from "./model-browser-keyboard";

function modelRow(provider: string, modelId: string): ProviderSelectionModelRow {
  return {
    favoriteKey: `${provider}:${modelId}`,
    provider,
    providerLabel: provider,
    modelId,
    modelLabel: modelId,
    description: modelId,
  };
}

const rows = [
  modelRow("codex", "gpt-5.4"),
  modelRow("codex", "gpt-5.4-mini"),
  modelRow("claude", "opus-5"),
];

describe("moveModelHighlight", () => {
  it("starts at the first model row from nothing, in either direction", () => {
    expect(moveModelHighlight({ rows, highlightedKey: null, direction: "next" })).toBe(
      "codex:gpt-5.4",
    );
    expect(moveModelHighlight({ rows, highlightedKey: null, direction: "previous" })).toBe(
      "codex:gpt-5.4",
    );
  });

  it("moves across provider boundaries", () => {
    expect(
      moveModelHighlight({ rows, highlightedKey: "codex:gpt-5.4-mini", direction: "next" }),
    ).toBe("claude:opus-5");
  });

  it("clamps at both ends instead of wrapping", () => {
    expect(moveModelHighlight({ rows, highlightedKey: "claude:opus-5", direction: "next" })).toBe(
      "claude:opus-5",
    );
    expect(
      moveModelHighlight({ rows, highlightedKey: "codex:gpt-5.4", direction: "previous" }),
    ).toBe("codex:gpt-5.4");
  });

  it("restarts at the top when the highlighted row was filtered out", () => {
    expect(moveModelHighlight({ rows, highlightedKey: "codex:gone", direction: "next" })).toBe(
      "codex:gpt-5.4",
    );
  });

  it("has nothing to move to in an empty or heading-only list", () => {
    expect(moveModelHighlight({ rows: [], highlightedKey: null, direction: "next" })).toBeNull();
  });
});

describe("resolveModelSubmitRow", () => {
  it("commits the top result when nothing is highlighted", () => {
    expect(resolveModelSubmitRow(rows, null)?.modelId).toBe("gpt-5.4");
  });

  it("commits the highlighted row", () => {
    expect(resolveModelSubmitRow(rows, "claude:opus-5")?.modelId).toBe("opus-5");
  });

  it("falls back to the top result when the highlighted row is gone", () => {
    expect(resolveModelSubmitRow(rows, "codex:gone")?.modelId).toBe("gpt-5.4");
  });

  it("has nothing to commit without model rows", () => {
    expect(resolveModelSubmitRow([], null)).toBeNull();
  });
});

import { describe, expect, it } from "vitest";
import type { CommandCenterContribution } from "./contributions";
import { buildCommandShortcutSettingsRows } from "./shortcut-settings";

function choice(input: {
  id: string;
  shortcutId: string;
  path: readonly [string, ...string[]];
}): CommandCenterContribution {
  return {
    id: input.id,
    shortcutId: input.shortcutId,
    group: input.path[0],
    groupRank: 1,
    rank: 0,
    keywords: [],
    visibility: "query",
    run: () => undefined,
    presentation: { kind: "choice", path: input.path, selected: false },
  };
}

describe("command shortcut settings", () => {
  it("lists discovered exact choices with stable persisted override keys", () => {
    const rows = buildCommandShortcutSettingsRows(
      [
        choice({
          id: "dynamic:models:codex:gpt-5.6-sol",
          shortcutId: "models:codex:gpt-5.6-sol",
          path: ["Model", "Codex", "GPT-5.6 Sol"],
        }),
        choice({
          id: "dynamic:thinking:high",
          shortcutId: "thinking:high",
          path: ["Thinking", "High"],
        }),
      ],
      { "command-center.shortcut:models:codex:gpt-5.6-sol": "F13" },
    );

    expect(rows).toEqual([
      {
        shortcutId: "models:codex:gpt-5.6-sol",
        bindingId: "command-center.shortcut:models:codex:gpt-5.6-sol",
        group: "models",
        label: "Codex · GPT-5.6 Sol",
        combo: "F13",
        available: true,
      },
      {
        shortcutId: "thinking:high",
        bindingId: "command-center.shortcut:thinking:high",
        group: "thinking",
        label: "High",
        combo: undefined,
        available: true,
      },
    ]);
  });

  it("collapses duplicate discoveries and gives top effort one semantic label", () => {
    const rows = buildCommandShortcutSettingsRows(
      [
        choice({
          id: "codex:ultra",
          shortcutId: "thinking:top",
          path: ["Thinking", "Ultra"],
        }),
        choice({
          id: "claude:ultracode",
          shortcutId: "thinking:top",
          path: ["Thinking", "Ultracode"],
        }),
      ],
      {},
    );

    expect(rows).toEqual([
      {
        shortcutId: "thinking:top",
        bindingId: "command-center.shortcut:thinking:top",
        group: "thinking",
        label: "Top",
        combo: undefined,
        available: true,
      },
    ]);
  });

  it("keeps stored unavailable targets visible for reset", () => {
    const rows = buildCommandShortcutSettingsRows([], {
      "command-center.shortcut:models:claude:claude-opus-5": "F14",
      "command-center.shortcut:thinking:top": "F24",
      "command-center.shortcut:": "F15",
      "unrelated-binding": "F16",
    });

    expect(rows).toEqual([
      {
        shortcutId: "models:claude:claude-opus-5",
        bindingId: "command-center.shortcut:models:claude:claude-opus-5",
        group: "models",
        label: "claude · claude-opus-5",
        combo: "F14",
        available: false,
      },
      {
        shortcutId: "thinking:top",
        bindingId: "command-center.shortcut:thinking:top",
        group: "thinking",
        label: "Top",
        combo: "F24",
        available: false,
      },
    ]);
  });
});

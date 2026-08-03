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
  it("lists available exact choices with their stable override keys", () => {
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

  it("keeps stored unavailable targets visible for reset without claiming availability", () => {
    const rows = buildCommandShortcutSettingsRows([], [], {
      "command-center.shortcut:models:claude:claude-opus-5": "F14",
      "command-center.shortcut:thinking:top": "F24",
      "unrelated-binding": "F15",
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
        label: "top",
        combo: "F24",
        available: false,
      },
    ]);
  });

  it("marks retained catalog targets unavailable after their live contribution unregisters", () => {
    const retained = choice({
      id: "dynamic:thinking:high",
      shortcutId: "thinking:high",
      path: ["Thinking", "High"],
    });

    expect(buildCommandShortcutSettingsRows([retained], [], {})).toEqual([
      expect.objectContaining({ shortcutId: "thinking:high", label: "High", available: false }),
    ]);
  });
});

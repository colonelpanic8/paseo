import { describe, expect, it } from "vitest";
import { resolveAutocompleteIsVisible } from "./use-agent-autocomplete";
import { findActiveSlashCommand } from "@/utils/agent-command-autocomplete";

describe("resolveAutocompleteIsVisible", () => {
  const commandBase = {
    mode: "command" as const,
    canLoadCommands: true,
    serverId: "server-1",
    autocompleteCwd: "/repo",
  };

  it.each(["/", "$", "/release", "$release"])(
    "opens %s before provider commands have loaded",
    (text) => {
      const command = findActiveSlashCommand({
        text,
        cursorIndex: text.length,
        sigils: { command: "/", skill: "$" },
      });
      expect(command).not.toBeNull();
      expect(
        resolveAutocompleteIsVisible({
          ...commandBase,
          mode: command ? "command" : null,
        }),
      ).toBe(true);
    },
  );

  it("stays closed when commands cannot be loaded at all", () => {
    expect(
      resolveAutocompleteIsVisible({
        ...commandBase,
        canLoadCommands: false,
      }),
    ).toBe(false);
  });

  it("keeps file mentions gated on a resolved workspace directory", () => {
    expect(
      resolveAutocompleteIsVisible({ ...commandBase, mode: "file", autocompleteCwd: "" }),
    ).toBe(false);
    expect(resolveAutocompleteIsVisible({ ...commandBase, mode: "file" })).toBe(true);
  });
});

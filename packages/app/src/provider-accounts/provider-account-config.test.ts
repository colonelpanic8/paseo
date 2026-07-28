import { describe, expect, test } from "vitest";
import type { MutableDaemonConfig } from "@getpaseo/protocol/messages";
import {
  buildProviderAccountConfigPatch,
  isAbsoluteHostPath,
  listProviderAccountConfigDirs,
} from "./provider-account-config";

function config(providers: MutableDaemonConfig["providers"] = {}): MutableDaemonConfig {
  return {
    mcp: { injectIntoAgents: false },
    browserTools: { enabled: false },
    providers,
    metadataGeneration: { providers: [] },
    autoArchiveAfterMerge: false,
    enableTerminalAgentHooks: false,
    appendSystemPrompt: "",
  };
}

describe("provider account config", () => {
  test("builds a derived Claude provider with an isolated config directory", () => {
    expect(
      buildProviderAccountConfigPatch(
        "claude",
        { name: "Work", configDir: "/home/ivan/.claude-work" },
        config(),
      ),
    ).toEqual({
      providerId: "claude-account-work",
      patch: {
        providers: {
          "claude-account-work": {
            extends: "claude",
            label: "Claude · Work",
            description: "Claude Code account with a separate configuration directory",
            env: { CLAUDE_CONFIG_DIR: "/home/ivan/.claude-work" },
            enabled: true,
          },
        },
      },
    });
  });

  test("builds a derived Codex provider with an isolated Codex home", () => {
    expect(
      buildProviderAccountConfigPatch(
        "codex",
        { name: "Work", configDir: "/home/ivan/.codex-work" },
        config(),
      ),
    ).toEqual({
      providerId: "codex-account-work",
      patch: {
        providers: {
          "codex-account-work": {
            extends: "codex",
            label: "Codex · Work",
            description: "Codex account with separate ChatGPT or OpenAI credentials",
            env: { CODEX_HOME: "/home/ivan/.codex-work" },
            enabled: true,
          },
        },
      },
    });
  });

  test("adds a stable suffix when the generated provider id is already used", () => {
    const existing = config({
      "claude-account-work": {
        extends: "claude",
        label: "Claude · Work",
      },
      "claude-account-work-2": {
        extends: "claude",
        label: "Claude · Other work",
      },
    });

    expect(
      buildProviderAccountConfigPatch(
        "claude",
        { name: "Work", configDir: "/home/ivan/.claude-third" },
        existing,
      ).providerId,
    ).toBe("claude-account-work-3");
  });

  test("recognizes Unix, Windows drive, and UNC absolute paths", () => {
    expect(isAbsoluteHostPath("/home/ivan/.claude-work")).toBe(true);
    expect(isAbsoluteHostPath("C:\\Users\\Ivan\\.claude-work")).toBe(true);
    expect(isAbsoluteHostPath("\\\\server\\share\\.claude-work")).toBe(true);
    expect(isAbsoluteHostPath("~/.claude-work")).toBe(false);
    expect(isAbsoluteHostPath(".claude-work")).toBe(false);
  });

  test("lists only Claude account config directories", () => {
    expect(
      listProviderAccountConfigDirs(
        "claude",
        config({
          "claude-account-work": {
            extends: "claude",
            accountConfigDir: "/accounts/work",
          },
          proxy: {
            extends: "claude",
            env: { ANTHROPIC_BASE_URL: "https://example.com" },
          },
          codex: {
            env: { CODEX_HOME: "/accounts/codex" },
          },
        }),
      ),
    ).toEqual(new Set(["/accounts/work"]));
  });

  test("lists only Codex account homes", () => {
    expect(
      listProviderAccountConfigDirs(
        "codex",
        config({
          "codex-account-work": {
            extends: "codex",
            accountConfigDir: "/accounts/work",
          },
          proxy: {
            extends: "codex",
            env: { OPENAI_BASE_URL: "https://example.com" },
          },
          claude: {
            env: { CLAUDE_CONFIG_DIR: "/accounts/claude" },
          },
        }),
      ),
    ).toEqual(new Set(["/accounts/work"]));
  });
});

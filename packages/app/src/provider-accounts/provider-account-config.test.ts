import { describe, expect, test } from "vitest";
import type { ProviderSnapshotEntry } from "@getpaseo/protocol/agent-types";
import type { MutableDaemonConfig } from "@getpaseo/protocol/messages";
import {
  buildProviderAccountConfigPatch,
  isAbsoluteHostPath,
  listProviderAccountBases,
  listProviderAccountConfigDirs,
  type ProviderAccountBase,
} from "./provider-account-config";

const CLAUDE: ProviderAccountBase = {
  providerId: "claude",
  label: "Claude",
  accounts: { envVar: "CLAUDE_CONFIG_DIR", directoryExample: "/home/you/.claude-work" },
};

const CODEX: ProviderAccountBase = {
  providerId: "codex",
  label: "Codex",
  accounts: { envVar: "CODEX_HOME", directoryExample: "/home/you/.codex-work" },
};

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

function snapshotEntry(entry: Partial<ProviderSnapshotEntry>): ProviderSnapshotEntry {
  return { provider: "claude", status: "ready", enabled: true, ...entry };
}

describe("provider account config", () => {
  test("offers accounts only for providers that reported support", () => {
    expect(
      listProviderAccountBases([
        snapshotEntry({
          provider: "claude",
          label: "Claude",
          accounts: { envVar: "CLAUDE_CONFIG_DIR", directoryExample: "/home/you/.claude-work" },
        }),
        snapshotEntry({ provider: "opencode", label: "OpenCode" }),
      ]),
    ).toEqual([CLAUDE]);
  });

  test("reports no account support when the host predates the feature", () => {
    expect(
      listProviderAccountBases([
        snapshotEntry({ provider: "claude", label: "Claude" }),
        snapshotEntry({ provider: "codex", label: "Codex" }),
      ]),
    ).toEqual([]);
  });

  test("builds an ordinary derived provider pointed at its own directory", () => {
    expect(
      buildProviderAccountConfigPatch(
        CLAUDE,
        { name: "Work", configDir: "/home/ivan/.claude-work" },
        new Set(["claude", "codex"]),
      ),
    ).toEqual({
      providerId: "claude-work",
      patch: {
        providers: {
          "claude-work": {
            extends: "claude",
            label: "Claude · Work",
            env: { CLAUDE_CONFIG_DIR: "/home/ivan/.claude-work" },
            enabled: true,
          },
        },
      },
    });
  });

  test("uses each provider's own account env var", () => {
    expect(
      buildProviderAccountConfigPatch(
        CODEX,
        { name: "Work", configDir: "/home/ivan/.codex-work" },
        new Set(["claude", "codex"]),
      ).patch.providers?.["codex-work"],
    ).toEqual({
      extends: "codex",
      label: "Codex · Work",
      env: { CODEX_HOME: "/home/ivan/.codex-work" },
      enabled: true,
    });
  });

  test("adds a stable suffix when the generated provider id is already used", () => {
    expect(
      buildProviderAccountConfigPatch(
        CLAUDE,
        { name: "Work", configDir: "/home/ivan/.claude-third" },
        new Set(["claude", "claude-work", "claude-work-2"]),
      ).providerId,
    ).toBe("claude-work-3");
  });

  test("never collides with a provider that only exists in the snapshot", () => {
    expect(
      buildProviderAccountConfigPatch(
        CLAUDE,
        { name: "Zai", configDir: "/home/ivan/.claude-zai" },
        new Set(["claude", "claude-zai"]),
      ).providerId,
    ).toBe("claude-zai-2");
  });

  test("recognizes Unix, Windows drive, and UNC absolute paths", () => {
    expect(isAbsoluteHostPath("/home/ivan/.claude-work")).toBe(true);
    expect(isAbsoluteHostPath("C:\\Users\\Ivan\\.claude-work")).toBe(true);
    expect(isAbsoluteHostPath("\\\\server\\share\\.claude-work")).toBe(true);
    expect(isAbsoluteHostPath("~/.claude-work")).toBe(false);
    expect(isAbsoluteHostPath(".claude-work")).toBe(false);
  });

  test("lists directories claimed by accounts of the same provider only", () => {
    expect(
      listProviderAccountConfigDirs(
        CLAUDE,
        config({
          "claude-work": {
            extends: "claude",
            accountConfigDir: "/accounts/work",
          },
          proxy: {
            extends: "claude",
            env: { ANTHROPIC_BASE_URL: "https://example.com" },
          },
          "codex-work": {
            extends: "codex",
            accountConfigDir: "/accounts/codex",
          },
        }),
      ),
    ).toEqual(new Set(["/accounts/work"]));
  });

  test("lists Codex account homes separately from Claude's", () => {
    expect(
      listProviderAccountConfigDirs(
        CODEX,
        config({
          "codex-work": {
            extends: "codex",
            accountConfigDir: "/accounts/work",
          },
          "claude-work": {
            extends: "claude",
            accountConfigDir: "/accounts/claude",
          },
        }),
      ),
    ).toEqual(new Set(["/accounts/work"]));
  });
});

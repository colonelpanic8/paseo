import { describe, expect, test } from "vitest";
import { createInitialMutableDaemonConfig, type PaseoDaemonConfig } from "./bootstrap.js";

describe("initial mutable daemon config", () => {
  test("restores safe account metadata from persisted provider overrides", () => {
    const initial = createInitialMutableDaemonConfig({
      providerOverrides: {
        "claude-account-work": {
          extends: "claude",
          label: "Claude · Work",
          description: "Separate Claude account",
          env: {
            CLAUDE_CONFIG_DIR: "/accounts/claude-work",
            ANTHROPIC_API_KEY: "secret",
          },
        },
        "codex-account-personal": {
          extends: "codex",
          label: "Codex · Personal",
          env: {
            CODEX_HOME: "/accounts/codex-personal",
            OPENAI_API_KEY: "also-secret",
          },
        },
      },
    } as PaseoDaemonConfig);

    expect(initial.providers).toEqual({
      "claude-account-work": {
        extends: "claude",
        label: "Claude · Work",
        description: "Separate Claude account",
        accountConfigDir: "/accounts/claude-work",
      },
      "codex-account-personal": {
        extends: "codex",
        label: "Codex · Personal",
        accountConfigDir: "/accounts/codex-personal",
      },
    });
    expect(JSON.stringify(initial)).not.toContain("secret");
  });
});

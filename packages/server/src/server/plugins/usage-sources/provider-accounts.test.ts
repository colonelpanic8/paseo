import { expect, test } from "vitest";
import { providerAccountUsage } from "./provider-accounts.js";

test("discovers provider accounts that point at their own login", () => {
  const providers = {
    "claude-work": {
      extends: "claude",
      label: "Work",
      env: { CLAUDE_CONFIG_DIR: "/work", CLAUDE_HOME: "/other" },
    },
    "claude-default": { extends: "claude" },
    "codex-work": { extends: "codex", env: { CODEX_HOME: "/codex" } },
    "copilot-work": { extends: "copilot", env: { GITHUB_PAT: "selected" } },
  };
  expect(providerAccountUsage("claude", providers)).toEqual([
    {
      key: "provider.claude-work",
      label: "Work",
      input: { route: { store: "claude", path: "/work/.credentials.json" } },
    },
  ]);
  expect(providerAccountUsage("codex", providers)).toEqual([
    {
      key: "provider.codex-work",
      label: "codex-work",
      input: { route: { store: "codex", path: "/codex/auth.json" } },
    },
  ]);
  expect(providerAccountUsage("copilot", providers)).toEqual([
    {
      key: "provider.copilot-work",
      label: "copilot-work",
      input: { store: "token", token: "selected" },
    },
  ]);
  expect(providerAccountUsage("other", providers)).toEqual([]);
});

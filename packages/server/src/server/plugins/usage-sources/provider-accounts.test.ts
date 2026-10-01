import { expect, test } from "vitest";
import { providerAccountUsageInputs } from "./provider-accounts.js";

test("discovers configured identities, credentials, and unavailable accounts", () => {
  const providers = {
    "claude-work": {
      extends: "claude",
      label: "Work",
      env: { CLAUDE_CONFIG_DIR: "/work", CLAUDE_HOME: "/other" },
    },
    "claude-empty": { extends: "claude" },
    "codex-work": { extends: "codex", env: { CODEX_HOME: "/codex" } },
    "copilot-work": { extends: "copilot", env: { GITHUB_PAT: "selected" } },
  };
  expect(providerAccountUsageInputs("claude", providers)).toEqual([
    { providerId: "claude-work", label: "Work", configDir: "/work" },
    { providerId: "claude-empty", label: "claude-empty" },
  ]);
  expect(providerAccountUsageInputs("codex", providers)).toEqual([
    { providerId: "codex-work", label: "codex-work", codexHome: "/codex" },
  ]);
  expect(providerAccountUsageInputs("copilot", providers)).toEqual([
    { providerId: "copilot-work", label: "copilot-work", accessToken: "selected" },
  ]);
  expect(providerAccountUsageInputs("other", providers)).toEqual([]);
});

import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import {
  identify as identifyClaude,
  resolveClaudeCredentials,
} from "./claude-usage-source/server/usage.js";
import { identify as identifyCodex, readAuth } from "./codex-usage-source/server/usage.js";
import {
  identify as identifyCopilot,
  fetchUsage as fetchCopilot,
} from "./copilot-usage-source/server/usage.js";
const dirs: string[] = [];
afterEach(() => {
  vi.unstubAllEnvs();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
function directory() {
  const dir = mkdtempSync(join(tmpdir(), "paseo-account-usage-"));
  dirs.push(dir);
  return dir;
}

test("custom Claude profiles never use the default home or keychain; the default honors CLAUDE_CONFIG_DIR", async () => {
  const dir = directory();
  writeFileSync(
    join(dir, ".credentials.json"),
    JSON.stringify({ claudeAiOauth: { accessToken: "default-token" } }),
  );
  vi.stubEnv("CLAUDE_CONFIG_DIR", dir);
  const keychain = vi.fn(async () => ({ claudeAiOauth: { accessToken: "keychain-token" } }));
  expect(
    await resolveClaudeCredentials(
      { providerId: "claude-empty", label: "Empty" },
      { platform: "darwin", readKeychainCredentials: keychain },
    ),
  ).toBeNull();
  expect(
    await resolveClaudeCredentials(
      { providerId: "claude-missing", label: "Missing", configDir: join(dir, "missing") },
      { platform: "darwin", readKeychainCredentials: keychain },
    ),
  ).toBeNull();
  expect(keychain).not.toHaveBeenCalled();
  expect(await resolveClaudeCredentials({}, { platform: "linux" })).toMatchObject({
    oauth: { accessToken: "default-token" },
  });
  expect(await identifyClaude({ providerId: "claude-empty", label: "Empty" })).toEqual({
    key: "provider.claude-empty",
    label: "Empty",
  });
});

test("Codex reports retain configured identities even when profiles share a credential home", async () => {
  const dir = directory();
  writeFileSync(
    join(dir, "auth.json"),
    JSON.stringify({ tokens: { access_token: "default-token", account_id: "same-account" } }),
  );
  vi.stubEnv("CODEX_HOME", dir);
  expect(await readAuth({ providerId: "codex-empty", label: "Empty" })).toBeNull();
  expect(
    await readAuth({
      providerId: "codex-missing",
      label: "Missing",
      codexHome: join(dir, "missing"),
    }),
  ).toBeNull();
  for (const providerId of ["codex-work", "codex-personal"]) {
    const input = { providerId, label: providerId, codexHome: dir };
    expect(await identifyCodex(input)).toEqual({
      key: `provider.${providerId}`,
      label: providerId,
    });
    expect(await readAuth(input)).toMatchObject({ token: "default-token" });
  }
});

test("Copilot profiles use only their supplied token and remain visible without credentials", async () => {
  vi.stubEnv("GITHUB_TOKEN", "default-token");
  const fetchApi = vi.fn(
    async () => new Response(JSON.stringify({ copilot_plan: "business" }), { status: 200 }),
  );
  const missing = { providerId: "copilot-empty", label: "Empty" };
  expect(await identifyCopilot(missing)).toEqual({ key: "provider.copilot-empty", label: "Empty" });
  expect(await fetchCopilot(missing, fetchApi)).toMatchObject({ status: "unavailable" });
  expect(fetchApi).not.toHaveBeenCalled();
  await fetchCopilot(
    { providerId: "copilot-work", label: "Work", accessToken: "selected-token" },
    fetchApi,
  );
  expect(fetchApi.mock.calls[0]?.[1]).toMatchObject({
    headers: { Authorization: "token selected-token" },
  });
});

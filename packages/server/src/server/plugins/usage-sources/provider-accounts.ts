import path from "node:path";
import type { ProviderOverrides } from "@getpaseo/protocol/provider-config";

export const ACCOUNT_USAGE_SOURCES = new Set(["claude", "codex", "copilot"]);

export interface ProviderAccountUsage {
  key: string;
  label: string;
  input: Record<string, unknown>;
}

function credentialInput(
  sourceId: string,
  env: Record<string, string>,
): Record<string, unknown> | null {
  if (sourceId === "claude") {
    const directory = env["CLAUDE_CONFIG_DIR"] || env["CLAUDE_HOME"];
    return directory
      ? { route: { store: "claude", path: path.join(directory, ".credentials.json") } }
      : null;
  }
  if (sourceId === "codex") {
    const home = env["CODEX_HOME"];
    return home ? { route: { store: "codex", path: path.join(home, "auth.json") } } : null;
  }
  const token = env["COPILOT_TOKEN"] || env["GITHUB_TOKEN"] || env["GITHUB_PAT"];
  return token ? { store: "token", token } : null;
}

/**
 * Accounts for configured provider accounts that point at their own login. An account without
 * one shares the default login, which the source already discovers.
 */
export function providerAccountUsage(
  sourceId: string,
  providers: ProviderOverrides,
): ProviderAccountUsage[] {
  if (!ACCOUNT_USAGE_SOURCES.has(sourceId)) return [];
  return Object.entries(providers).flatMap(([providerId, config]) => {
    if (config.extends !== sourceId || !/^[A-Za-z0-9._-]{1,119}$/.test(providerId)) return [];
    const input = credentialInput(sourceId, config.env ?? {});
    if (!input) return [];
    return [{ key: `provider.${providerId}`, label: config.label?.trim() || providerId, input }];
  });
}

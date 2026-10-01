import type { ProviderOverrides } from "@getpaseo/protocol/provider-config";

export const ACCOUNT_USAGE_SOURCES = new Set(["claude", "codex", "copilot"]);

export function providerAccountUsageInputs(
  sourceId: string,
  providers: ProviderOverrides,
): Array<Record<string, string>> {
  if (!ACCOUNT_USAGE_SOURCES.has(sourceId)) return [];
  return Object.entries(providers).flatMap(([providerId, config]) => {
    if (config.extends !== sourceId || !/^[A-Za-z0-9._-]{1,119}$/.test(providerId)) return [];
    const input: Record<string, string> = { providerId, label: config.label?.trim() || providerId };
    const env = config.env ?? {};
    if (sourceId === "claude") {
      const directory = env["CLAUDE_CONFIG_DIR"] || env["CLAUDE_HOME"];
      if (directory) input.configDir = directory;
    } else if (sourceId === "codex") {
      if (env["CODEX_HOME"]) input.codexHome = env["CODEX_HOME"];
    } else {
      const token = env["COPILOT_TOKEN"] || env["GITHUB_TOKEN"] || env["GITHUB_PAT"];
      if (token) input.accessToken = token;
    }
    return [input];
  });
}

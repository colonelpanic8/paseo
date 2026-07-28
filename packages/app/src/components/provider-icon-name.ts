import {
  BUILTIN_PROVIDER_ICON_NAMES,
  KNOWN_PROVIDER_ICON_NAMES,
} from "@getpaseo/protocol/provider-icon-names";

export type ProviderIconName =
  | { kind: "builtin"; id: string }
  | { kind: "catalog"; id: string }
  | { kind: "bot" };

const BUILTIN_PROVIDER_IDS = new Set(BUILTIN_PROVIDER_ICON_NAMES);
const KNOWN_PROVIDER_IDS = new Set(KNOWN_PROVIDER_ICON_NAMES);

export function resolveProviderIconName(provider: string): ProviderIconName {
  if (provider.startsWith("claude-account-")) {
    return { kind: "builtin", id: "claude" };
  }
  if (provider.startsWith("codex-account-")) {
    return { kind: "builtin", id: "codex" };
  }
  if (BUILTIN_PROVIDER_IDS.has(provider)) {
    return { kind: "builtin", id: provider };
  }
  if (KNOWN_PROVIDER_IDS.has(provider)) {
    return { kind: "catalog", id: provider };
  }
  return { kind: "bot" };
}

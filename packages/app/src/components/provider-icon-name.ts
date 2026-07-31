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

function resolveExactProviderIconName(provider: string): ProviderIconName | null {
  if (BUILTIN_PROVIDER_IDS.has(provider)) {
    return { kind: "builtin", id: provider };
  }
  if (KNOWN_PROVIDER_IDS.has(provider)) {
    return { kind: "catalog", id: provider };
  }
  return null;
}

/**
 * Providers derived from another one — accounts, gateway profiles — are
 * registered as `<base>-<suffix>`, so they wear the base provider's icon.
 * Longest prefix wins, otherwise `mock-slow-work` would resolve to `mock`.
 */
function resolveDerivedProviderIconName(provider: string): ProviderIconName | null {
  for (
    let separator = provider.lastIndexOf("-");
    separator > 0;
    separator = provider.lastIndexOf("-", separator - 1)
  ) {
    const icon = resolveExactProviderIconName(provider.slice(0, separator));
    if (icon) {
      return icon;
    }
  }
  return null;
}

export function resolveProviderIconName(provider: string): ProviderIconName {
  return (
    resolveExactProviderIconName(provider) ??
    resolveDerivedProviderIconName(provider) ?? { kind: "bot" }
  );
}

/**
 * Presentation for the providers the usage-history contract reports. Provider
 * ids arrive as plain strings, so anything the daemon adds later still renders
 * with its id as the label rather than disappearing.
 */

/** Reading order across the chart, the summary rows, and the day table. */
export const PROVIDER_ORDER = ["claude", "codex"] as const;

const PROVIDER_LABELS: Record<string, string> = {
  claude: "Claude Code",
  codex: "Codex",
};

const KNOWN_PROVIDERS = new Set<string>(PROVIDER_ORDER);

/**
 * Provider brand colors, and the only place one lives.
 *
 * A brand color is fixed by whoever owns the brand, so it cannot come from the
 * theme; `styles/identity-colors.ts` is the precedent for a theme-independent
 * hex, and this table is scoped to the usage-history page. Anything not listed
 * draws in the theme's own foreground, which reads on every surface.
 */
export const PROVIDER_BRAND_COLORS: Record<string, string> = {
  claude: "#d97757",
};

export function providerSeriesColor(provider: string, foreground: string): string {
  return PROVIDER_BRAND_COLORS[provider] ?? foreground;
}

export function providerLabel(provider: string): string {
  return PROVIDER_LABELS[provider] ?? provider;
}

/**
 * Canonical order for a set of provider ids: the contract's providers first,
 * then anything else alphabetically.
 *
 * The known ids stay in the result even when they have no activity, so a
 * provider's index — and therefore its series color — does not move when the
 * other one is quiet for the window.
 */
export function orderProviders(providers: Iterable<string>): readonly string[] {
  const extra = [...new Set(providers)].filter((id) => !KNOWN_PROVIDERS.has(id)).sort();
  return [...PROVIDER_ORDER, ...extra];
}

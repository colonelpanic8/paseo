/**
 * Which facts a sidebar workspace row is allowed to show about a workspace.
 *
 * Each item is independent — this is not a mode. Turning one off removes it from every row and
 * gives the space back to the title. The one exception is the host, which pairs with
 * `alwaysShowHostLabels`; `resolveHostPair` below keeps the two in step.
 *
 * CI is not here: it has three answers rather than two, so it is its own setting in
 * `checks-display.ts`.
 *
 * Pure on purpose: `hooks/use-settings/storage.ts` validates the persisted value through
 * `parseSidebarRowItems` rather than growing its own checks, so this module stays the one place
 * that knows what an item is.
 */

export const SIDEBAR_ROW_ITEMS = [
  "branch",
  "project",
  "host",
  "changeRequest",
  "services",
  "labels",
] as const;

export type SidebarRowItem = (typeof SIDEBAR_ROW_ITEMS)[number];

export type SidebarRowItems = Record<SidebarRowItem, boolean>;

/** The persisted record is merged over these explicit product defaults. */
export const DEFAULT_SIDEBAR_ROW_ITEMS: SidebarRowItems = {
  branch: false,
  project: false,
  host: true,
  changeRequest: true,
  services: true,
  labels: true,
};

/**
 * COMPAT(sidebarRowItemsChecks): CI was a boolean row item until v0.3.0, when it became a
 * display mode of its own. A stored `false` is someone who switched checks off, and they must
 * not come back as icon-and-text on upgrade. Remove after 2027-08-05.
 */
export function isChecksHiddenByLegacyRowItem(value: unknown): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  return (value as Record<string, unknown>).checks === false;
}

function isSidebarRowItem(value: string): value is SidebarRowItem {
  return (SIDEBAR_ROW_ITEMS as readonly string[]).includes(value);
}

export function parseSidebarRowItems(value: unknown): SidebarRowItems {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return DEFAULT_SIDEBAR_ROW_ITEMS;
  }

  const stored = value as Record<string, unknown>;
  const result = { ...DEFAULT_SIDEBAR_ROW_ITEMS };
  // COMPAT(sidebarRowItemsScripts): the item was called "scripts" until v0.3.0, when it narrowed
  // to services only. A stored `false` is someone who switched it off. Remove after 2027-08-05.
  if (stored.scripts === false) {
    result.services = false;
  }
  for (const [key, entry] of Object.entries(stored)) {
    if (isSidebarRowItem(key) && typeof entry === "boolean") {
      result[key] = entry;
    }
  }
  return result;
}

/** The host's two switches: whether a row may draw a host at all, and when it does. */
export interface HostPairState {
  rowItems: SidebarRowItems;
  alwaysShowHostLabels: boolean;
}

/**
 * Both host switches after one of them is flipped.
 *
 * They are separate settings but a single decision, so neither is allowed to sit ticked while
 * the other makes it draw nothing: switching the host off drops the override with it, and
 * asking for the host unconditionally switches the item back on. Every other row item answers
 * only for itself and passes straight through.
 */
export function resolveHostPair(
  current: HostPairState,
  flipped: SidebarRowItem | "alwaysShowHostLabels",
): HostPairState {
  if (flipped === "alwaysShowHostLabels") {
    const alwaysShowHostLabels = !current.alwaysShowHostLabels;
    return {
      alwaysShowHostLabels,
      rowItems: alwaysShowHostLabels ? { ...current.rowItems, host: true } : current.rowItems,
    };
  }

  const enabled = !current.rowItems[flipped];
  return {
    rowItems: { ...current.rowItems, [flipped]: enabled },
    alwaysShowHostLabels: flipped === "host" && !enabled ? false : current.alwaysShowHostLabels,
  };
}

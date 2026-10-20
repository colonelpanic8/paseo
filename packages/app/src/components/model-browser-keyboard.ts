import type { ProviderSelectionModelRow } from "@/provider-selection/provider-selection";

/**
 * Moves the keyboard highlight one row, clamped at both ends instead of
 * wrapping. Clamping keeps every step adjacent to the current row, so the row
 * the highlight lands on is always mounted in a virtualized list and can be
 * scrolled into view; wrapping to the far end of a long catalog would highlight
 * a row that was never rendered.
 *
 * With nothing highlighted, either direction lands on the first row — the same
 * row Enter commits when nothing is highlighted.
 */
export function moveModelHighlight({
  rows,
  highlightedKey,
  direction,
}: {
  rows: ProviderSelectionModelRow[];
  highlightedKey: string | null;
  direction: "next" | "previous";
}): string | null {
  if (rows.length === 0) return null;
  const current = rows.findIndex((row) => row.favoriteKey === highlightedKey);
  if (current === -1) return rows[0].favoriteKey;
  const next =
    direction === "next" ? Math.min(current + 1, rows.length - 1) : Math.max(current - 1, 0);
  return rows[next].favoriteKey;
}

/** The row Enter commits: the highlighted one, or the top result when none is. */
export function resolveModelSubmitRow(
  rows: ProviderSelectionModelRow[],
  highlightedKey: string | null,
): ProviderSelectionModelRow | null {
  if (rows.length === 0) return null;
  const highlighted = rows.find((row) => row.favoriteKey === highlightedKey);
  return highlighted ?? rows[0];
}

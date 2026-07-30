import type { StreamItem } from "@/types/stream";

export interface TurnAttribution {
  model?: string;
  thinkingOptionId?: string;
}

/**
 * What the provider ran for one completed turn, read from the turn's assistant
 * messages.
 *
 * Reads the last attributed message rather than the first: when a turn spans a
 * model change, the value the turn *ended* on is the one the footer sits under.
 * Returns null when nothing in the turn carried attribution, which is the normal
 * case for history recorded before the daemon reported it.
 */
export function resolveTurnAttribution(
  items: readonly StreamItem[],
  startIndex: number,
): TurnAttribution | null {
  let found: TurnAttribution | null = null;
  for (let index = startIndex; index < items.length; index += 1) {
    const item = items[index];
    if (!item || item.kind !== "assistant_message") {
      continue;
    }
    if (item.model === undefined && item.thinkingOptionId === undefined) {
      continue;
    }
    found = {
      ...(item.model !== undefined ? { model: item.model } : {}),
      ...(item.thinkingOptionId !== undefined ? { thinkingOptionId: item.thinkingOptionId } : {}),
    };
  }
  return found;
}

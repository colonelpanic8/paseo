import { MAX_CONTENT_WIDTH } from "@/constants/layout";
import type { StreamItem } from "@/types/stream";

export const TURN_MINIMAP_ITEM_SPACING = 8;
export const TURN_MINIMAP_MIN_ITEMS = 2;
export const TURN_MINIMAP_REQUIRED_GUTTER = 48;
export const TURN_MINIMAP_VERTICAL_INSET = 32;

export interface TurnMinimapItem {
  id: string;
  rowIndex: number;
  userText: string | null;
  assistantText: string | null;
}

export function deriveTurnMinimapItems(items: readonly StreamItem[]): TurnMinimapItem[] {
  const turns: TurnMinimapItem[] = [];
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    if (item?.kind !== "user_message") {
      continue;
    }

    turns.push({
      id: item.id,
      rowIndex: index,
      userText: compactPreview(item.text),
      assistantText: compactPreview(resolveFinalAssistantText(items, index)),
    });
  }
  return turns;
}

export function resolveTurnMinimapHeight(itemCount: number, viewportHeight: number): number {
  const naturalHeight = Math.max(1, (itemCount - 1) * TURN_MINIMAP_ITEM_SPACING);
  const availableHeight = Math.max(1, viewportHeight - TURN_MINIMAP_VERTICAL_INSET * 2);
  return Math.min(naturalHeight, availableHeight);
}

export function resolveTurnMinimapTopPercent(index: number, itemCount: number): number {
  if (itemCount <= 1) {
    return 0;
  }
  const boundedIndex = Math.max(0, Math.min(index, itemCount - 1));
  return (boundedIndex / (itemCount - 1)) * 100;
}

export function resolveTurnMinimapIndexFromPointer(input: {
  itemCount: number;
  railTop: number;
  railHeight: number;
  pointerY: number;
}): number | null {
  if (input.itemCount <= 0 || input.railHeight <= 0) {
    return null;
  }
  if (input.itemCount === 1) {
    return 0;
  }

  const progress = Math.max(0, Math.min(1, (input.pointerY - input.railTop) / input.railHeight));
  return Math.round(progress * (input.itemCount - 1));
}

export function turnMinimapHasEnoughSpace(viewportWidth: number): boolean {
  if (!Number.isFinite(viewportWidth) || viewportWidth <= 0) {
    return false;
  }

  const contentWidth = Math.min(viewportWidth, MAX_CONTENT_WIDTH);
  const sideGutter = Math.max(0, (viewportWidth - contentWidth) / 2);
  return sideGutter >= TURN_MINIMAP_REQUIRED_GUTTER;
}

function resolveFinalAssistantText(
  items: readonly StreamItem[],
  userRowIndex: number,
): string | null {
  let finalAssistantText: string | null = null;
  for (let index = userRowIndex + 1; index < items.length; index += 1) {
    const item = items[index];
    if (item?.kind === "user_message") {
      break;
    }
    if (item?.kind === "assistant_message") {
      finalAssistantText = item.text;
    }
  }
  return finalAssistantText;
}

function compactPreview(text: string | null | undefined): string | null {
  const compact = text?.replace(/\s+/g, " ").trim() ?? "";
  return compact.length > 0 ? compact : null;
}

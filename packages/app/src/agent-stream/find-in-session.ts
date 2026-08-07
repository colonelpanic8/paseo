import type { StreamItem } from "@/types/stream";

export interface SessionFindMatch {
  itemId: string;
  /** 0-based occurrence position within the item's searchable text. */
  occurrenceIndex: number;
}

export interface SessionFindState {
  query: string;
  activeItemId: string | null;
  activeOccurrenceIndex: number;
  /**
   * How many occurrences the match model found in the active item. Renderers
   * compare this against what they can enumerate to decide whether
   * `activeOccurrenceIndex` identifies the same occurrence they see.
   */
  activeItemOccurrenceCount: number;
}

function extractVisibleMarkdownText(markdown: string): string {
  return markdown
    .replace(/!\[([^\]]*)\]\((?:[^()\\]|\\.)*\)/g, "$1")
    .replace(/\[([^\]]+)\]\((?:[^()\\]|\\.)*\)/g, "$1")
    .replace(/^\s*```[^\n]*$/gm, "")
    .replace(/^\s*~~~[^\n]*$/gm, "")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s{0,3}>+\s?/gm, "")
    .replace(/^\s{0,3}(?:[*+-]|\d+\.)\s+/gm, "")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/(\*\*|__)(.*?)\1/g, "$2")
    .replace(/(\*|_)(.*?)\1/g, "$2")
    .replace(/~~([^~]+)~~/g, "$1");
}

/**
 * Text that is visible in the stream by default. Collapsed content (reasoning,
 * tool call inputs/outputs) is intentionally excluded so every match can be
 * scrolled to and seen without expanding anything.
 */
export function extractSearchableText(item: StreamItem): string {
  switch (item.kind) {
    case "user_message":
    case "assistant_message":
      return extractVisibleMarkdownText(item.text);
    case "activity_log":
      return item.message;
    case "todo_list":
      return item.items.map((entry) => entry.text).join("\n");
    case "tool_call": {
      const { payload } = item;
      // Speak tool calls render inline as chat messages (see SpeakMessage).
      if (
        payload.source === "agent" &&
        payload.data.name === "speak" &&
        payload.data.detail.type === "unknown" &&
        typeof payload.data.detail.input === "string"
      ) {
        return payload.data.detail.input;
      }
      return "";
    }
    default:
      return "";
  }
}

// Stream items are immutable snapshots, so the lowercased text can be cached
// per item to keep per-keystroke matching cheap on long sessions.
const lowerCaseTextCache = new WeakMap<StreamItem, string>();

function getLowerCaseSearchableText(item: StreamItem): string {
  const cached = lowerCaseTextCache.get(item);
  if (cached !== undefined) {
    return cached;
  }
  const text = extractSearchableText(item).toLowerCase();
  lowerCaseTextCache.set(item, text);
  return text;
}

/**
 * Enumerates case-insensitive, non-overlapping occurrences of `query` across
 * the stream in display order.
 */
export function computeSessionFindMatches(
  items: readonly StreamItem[],
  query: string,
): SessionFindMatch[] {
  if (query.length === 0) {
    return [];
  }
  const needle = query.toLowerCase();
  const matches: SessionFindMatch[] = [];
  for (const item of items) {
    const haystack = getLowerCaseSearchableText(item);
    if (haystack.length === 0) {
      continue;
    }
    let occurrenceIndex = 0;
    let searchFrom = 0;
    while (true) {
      const foundAt = haystack.indexOf(needle, searchFrom);
      if (foundAt < 0) {
        break;
      }
      matches.push({ itemId: item.id, occurrenceIndex });
      occurrenceIndex += 1;
      searchFrom = foundAt + needle.length;
    }
  }
  return matches;
}

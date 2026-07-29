import { baseColors } from "@/styles/theme";
import type { SessionFindState } from "./find-in-session";

/**
 * Text-level match highlighting for find-in-session via the CSS Custom
 * Highlight API. Ranges are registered against text nodes inside
 * `[data-stream-item-id]` rows, so no React re-render or markdown rewriting is
 * needed. On runtimes without the API (or native), everything degrades to
 * scroll-to-row with no text highlight.
 *
 * `CSS.highlights` is a document-global registry, but stream viewports are not:
 * retained tabs and split panes keep several mounted at once, all of them
 * re-running their highlight pass whenever their own agent streams. Each
 * viewport therefore acquires its own highlight slot and only ever writes or
 * deletes the two names belonging to that slot, so a background pane cannot
 * clear the foreground pane's highlights and two open find bars do not
 * overwrite each other. Slots are pooled on release, so the number of
 * registered `::highlight()` rules stays bounded by peak concurrent viewports.
 */

const HIGHLIGHT_STYLE_ELEMENT_ID = "paseo-session-find-highlight-style";

export interface SessionFindHighlightOwner {
  readonly slot: number;
  readonly matchName: string;
  readonly activeName: string;
}

interface HighlightRegistry {
  set(name: string, highlight: unknown): void;
  delete(name: string): void;
}

interface HighlightConstructor {
  new (...ranges: Range[]): unknown;
}

const releasedSlots: number[] = [];
const slotsWithStyles = new Set<number>();
let nextSlot = 0;

function getHighlightSupport(): {
  registry: HighlightRegistry;
  Highlight: HighlightConstructor;
} | null {
  if (typeof document === "undefined" || typeof CSS === "undefined") {
    return null;
  }
  const css = CSS as unknown as { highlights?: HighlightRegistry };
  const highlightCtor = (globalThis as { Highlight?: HighlightConstructor }).Highlight;
  if (!css.highlights || typeof highlightCtor !== "function") {
    return null;
  }
  return { registry: css.highlights, Highlight: highlightCtor };
}

function ensureSlotStyles(owner: SessionFindHighlightOwner): void {
  if (slotsWithStyles.has(owner.slot)) {
    return;
  }
  let style = document.getElementById(HIGHLIGHT_STYLE_ELEMENT_ID);
  if (!style) {
    style = document.createElement("style");
    style.id = HIGHLIGHT_STYLE_ELEMENT_ID;
    document.head.appendChild(style);
  }
  // Alpha-tinted palette values read on both light and dark surfaces; the
  // active occurrence gets a solid fill so it stands out among matches.
  style.textContent += [
    `::highlight(${owner.matchName}) { background-color: ${baseColors.amber[500]}4d; }`,
    `::highlight(${owner.activeName}) { background-color: ${baseColors.amber[500]}; color: ${baseColors.zinc[900]}; }`,
    "",
  ].join("\n");
  slotsWithStyles.add(owner.slot);
}

export function acquireSessionFindHighlightOwner(): SessionFindHighlightOwner {
  const slot = releasedSlots.pop() ?? nextSlot++;
  return {
    slot,
    matchName: `paseo-session-find-match-${slot}`,
    activeName: `paseo-session-find-active-${slot}`,
  };
}

export function releaseSessionFindHighlightOwner(owner: SessionFindHighlightOwner): void {
  clearSessionFindHighlights(owner);
  if (!releasedSlots.includes(owner.slot)) {
    releasedSlots.push(owner.slot);
  }
}

function collectTextNodes(root: Element): Text[] {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  let node = walker.nextNode();
  while (node) {
    nodes.push(node as Text);
    node = walker.nextNode();
  }
  return nodes;
}

function collectRowRanges(row: Element, needle: string): Range[] {
  const ranges: Range[] = [];
  for (const textNode of collectTextNodes(row)) {
    const haystack = textNode.textContent?.toLowerCase();
    if (!haystack) {
      continue;
    }
    let searchFrom = 0;
    while (true) {
      const foundAt = haystack.indexOf(needle, searchFrom);
      if (foundAt < 0) {
        break;
      }
      const range = document.createRange();
      range.setStart(textNode, foundAt);
      range.setEnd(textNode, foundAt + needle.length);
      ranges.push(range);
      searchFrom = foundAt + needle.length;
    }
  }
  return ranges;
}

/**
 * Splits the active row's DOM ranges into active and non-active occurrences.
 *
 * The match model enumerates occurrences in an item's source text, while these
 * ranges are enumerated over rendered text nodes. Those two sequences agree for
 * ordinary prose but not always: a needle straddling an inline-formatting or
 * syntax-token boundary yields no DOM range, and rendered chrome inside a row
 * can contribute a range the model never saw. Indexing blindly would then
 * emphasize an unrelated occurrence, so the ordinal is trusted only when the
 * two enumerations demonstrably agree on the row's occurrence count. Otherwise
 * every occurrence in the row is emphasized — the row is where navigation
 * scrolled to, so "your match is one of these" stays true.
 */
function partitionActiveRowRanges(
  rowRanges: Range[],
  find: SessionFindState,
): { active: Range[]; match: Range[] } {
  const enumerationsAgree = rowRanges.length === find.activeItemOccurrenceCount;
  if (!enumerationsAgree) {
    return { active: rowRanges, match: [] };
  }
  const active: Range[] = [];
  const match: Range[] = [];
  rowRanges.forEach((range, occurrenceIndex) => {
    if (occurrenceIndex === find.activeOccurrenceIndex) {
      active.push(range);
    } else {
      match.push(range);
    }
  });
  return { active, match };
}

/**
 * Re-scans the mounted rows inside `container` and replaces the highlight
 * ranges registered under `owner`'s slot.
 */
export function applySessionFindHighlights(input: {
  owner: SessionFindHighlightOwner;
  container: HTMLElement;
  find: SessionFindState;
}): void {
  const support = getHighlightSupport();
  if (!support) {
    return;
  }
  ensureSlotStyles(input.owner);

  const needle = input.find.query.toLowerCase();
  const matchRanges: Range[] = [];
  const activeRanges: Range[] = [];
  if (needle.length > 0) {
    const rows = input.container.querySelectorAll("[data-stream-item-id]");
    for (const row of rows) {
      const rowRanges = collectRowRanges(row, needle);
      if (row.getAttribute("data-stream-item-id") !== input.find.activeItemId) {
        matchRanges.push(...rowRanges);
        continue;
      }
      const partitioned = partitionActiveRowRanges(rowRanges, input.find);
      activeRanges.push(...partitioned.active);
      matchRanges.push(...partitioned.match);
    }
  }

  support.registry.set(input.owner.matchName, new support.Highlight(...matchRanges));
  support.registry.set(input.owner.activeName, new support.Highlight(...activeRanges));
}

export function clearSessionFindHighlights(owner: SessionFindHighlightOwner): void {
  const support = getHighlightSupport();
  if (!support) {
    return;
  }
  support.registry.delete(owner.matchName);
  support.registry.delete(owner.activeName);
}

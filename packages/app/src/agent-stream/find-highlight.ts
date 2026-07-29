import { baseColors } from "@/styles/theme";
import type { SessionFindState } from "./find-in-session";

/**
 * Text-level match highlighting for find-in-session via the CSS Custom
 * Highlight API. Ranges are registered against text nodes inside
 * `[data-stream-item-id]` rows, so no React re-render or markdown rewriting is
 * needed. On runtimes without the API (or native), everything degrades to
 * scroll-to-row with no text highlight.
 *
 * CSS.highlights is document-global; if two panes run a find at once, the
 * last-applied pass wins. That is acceptable for a transient overlay.
 */

const MATCH_HIGHLIGHT_NAME = "paseo-session-find-match";
const ACTIVE_HIGHLIGHT_NAME = "paseo-session-find-active";
const HIGHLIGHT_STYLE_ELEMENT_ID = "paseo-session-find-highlight-style";

interface HighlightRegistry {
  set(name: string, highlight: unknown): void;
  delete(name: string): void;
}

interface HighlightConstructor {
  new (...ranges: Range[]): unknown;
}

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

function ensureHighlightStyles(): void {
  if (document.getElementById(HIGHLIGHT_STYLE_ELEMENT_ID)) {
    return;
  }
  const style = document.createElement("style");
  style.id = HIGHLIGHT_STYLE_ELEMENT_ID;
  // Alpha-tinted palette values read on both light and dark surfaces; the
  // active occurrence gets a solid fill so it stands out among matches.
  style.textContent = [
    `::highlight(${MATCH_HIGHLIGHT_NAME}) { background-color: ${baseColors.amber[500]}4d; }`,
    `::highlight(${ACTIVE_HIGHLIGHT_NAME}) { background-color: ${baseColors.amber[500]}; color: ${baseColors.zinc[900]}; }`,
  ].join("\n");
  document.head.appendChild(style);
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
 * Re-scans the mounted rows inside `container` and replaces the registered
 * highlight ranges. Occurrences are matched per text node, so a match split
 * across inline formatting boundaries is skipped (best effort).
 */
export function applySessionFindHighlights(input: {
  container: HTMLElement;
  find: SessionFindState;
}): void {
  const support = getHighlightSupport();
  if (!support) {
    return;
  }
  ensureHighlightStyles();

  const needle = input.find.query.toLowerCase();
  const matchRanges: Range[] = [];
  const activeRanges: Range[] = [];
  if (needle.length > 0) {
    const rows = input.container.querySelectorAll("[data-stream-item-id]");
    for (const row of rows) {
      const rowRanges = collectRowRanges(row, needle);
      const isActiveRow = row.getAttribute("data-stream-item-id") === input.find.activeItemId;
      rowRanges.forEach((range, occurrenceIndex) => {
        if (isActiveRow && occurrenceIndex === input.find.activeOccurrenceIndex) {
          activeRanges.push(range);
        } else {
          matchRanges.push(range);
        }
      });
    }
  }

  support.registry.set(MATCH_HIGHLIGHT_NAME, new support.Highlight(...matchRanges));
  support.registry.set(ACTIVE_HIGHLIGHT_NAME, new support.Highlight(...activeRanges));
}

export function clearSessionFindHighlights(): void {
  const support = getHighlightSupport();
  if (!support) {
    return;
  }
  support.registry.delete(MATCH_HIGHLIGHT_NAME);
  support.registry.delete(ACTIVE_HIGHLIGHT_NAME);
}

/**
 * @vitest-environment jsdom
 */
import { act, renderHook } from "@testing-library/react";
import { createRef } from "react";
import { describe, expect, it, vi } from "vitest";
import { keyboardActionDispatcher } from "@/keyboard/keyboard-action-dispatcher";
import { resolveKeyboardShortcut } from "@/keyboard/keyboard-shortcuts";
import { routeKeyboardShortcut } from "@/keyboard/route-shortcut";
import type { StreamItem } from "@/types/stream";
import type { StreamViewportHandle } from "./strategy";
import { useSessionFind } from "./use-session-find";

function userMessage(id: string, text: string): StreamItem {
  return { kind: "user_message", id, text, timestamp: new Date(0) };
}

function assistantMessage(id: string, text: string): StreamItem {
  return { kind: "assistant_message", id, text, timestamp: new Date(0) };
}

const ITEMS: StreamItem[] = [
  userMessage("first", "deploy the service"),
  assistantMessage("second", "no matches in here"),
  assistantMessage("third", "deploy again, then deploy once more"),
];

function setup(items: readonly StreamItem[] = ITEMS) {
  const scrollToItem = vi.fn();
  const viewportRef = createRef<StreamViewportHandle>() as {
    current: StreamViewportHandle | null;
  };
  viewportRef.current = {
    scrollToBottom: vi.fn(),
    prepareForViewportChange: vi.fn(),
    scrollToItem,
  };
  const rendered = renderHook(
    ({ agentId }: { agentId: string }) =>
      useSessionFind({
        agentId,
        items,
        viewportRef,
        isPaneFocused: true,
        isPanelActive: true,
      }),
    { initialProps: { agentId: "agent-1" } },
  );
  return { ...rendered, scrollToItem };
}

function openFind(): void {
  act(() => {
    keyboardActionDispatcher.dispatch({ id: "agent.find", scope: "workspace" });
  });
}

/**
 * Drives the same chain the app's window keydown listener does — real binding
 * resolution, real routing, real dispatcher — so the find shortcut is covered
 * from the keystroke through to the handler rather than from the action alone.
 */
function pressFindShortcut({ isMac }: { isMac: boolean }): void {
  const resolved = resolveKeyboardShortcut({
    event: {
      key: "f",
      code: "KeyF",
      altKey: false,
      ctrlKey: !isMac,
      metaKey: isMac,
      shiftKey: false,
      repeat: false,
    },
    context: { isMac, isDesktop: true, focusScope: "other", commandCenterOpen: false },
    chordState: { candidateIndices: [], step: 0, timeoutId: null },
    onChordReset: () => undefined,
  });
  const match = resolved.match;
  if (!match) {
    throw new Error("expected the find shortcut to resolve to an action");
  }
  const routed = routeKeyboardShortcut(
    { action: match.action, payload: match.payload },
    {
      pathname: "/host/local/workspace/ws-1",
      isMobile: false,
      sidebarShortcutTargets: [],
      navigationActiveWorkspace: null,
      commandCenterOpen: false,
      shortcutsDialogOpen: false,
    },
  );
  if (routed.kind !== "dispatch") {
    throw new Error(`expected a dispatch action, got ${routed.kind}`);
  }
  act(() => {
    keyboardActionDispatcher.dispatch(routed.action);
  });
}

function pressEscape(): boolean {
  let handled = false;
  act(() => {
    handled = keyboardActionDispatcher.dispatch({ id: "agent.interrupt", scope: "global" });
  });
  return handled;
}

describe("useSessionFind", () => {
  it("starts closed and ignores Escape so the agent-interrupt handler still receives it", () => {
    const { result } = setup();

    expect(result.current.isOpen).toBe(false);
    expect(pressEscape()).toBe(false);
    expect(result.current.isOpen).toBe(false);
  });

  it.each([
    { platform: "mac", isMac: true },
    { platform: "non-mac", isMac: false },
  ])("opens and scrolls to the first match from a $platform find keystroke", ({ isMac }) => {
    const { result, scrollToItem } = setup();

    pressFindShortcut({ isMac });
    expect(result.current.isOpen).toBe(true);

    act(() => {
      result.current.onQueryChange("deploy");
    });

    expect(scrollToItem).toHaveBeenCalledWith("first");
    expect(result.current.matches).toHaveLength(3);
  });

  it("opens on the agent.find keyboard action and requests input focus", () => {
    const { result } = setup();
    const focusRequestBefore = result.current.focusRequestId;

    act(() => {
      keyboardActionDispatcher.dispatch({ id: "agent.find", scope: "workspace" });
    });

    expect(result.current.isOpen).toBe(true);
    expect(result.current.focusRequestId).toBeGreaterThan(focusRequestBefore);
  });

  it("scrolls to the first match and counts every occurrence as the query is typed", () => {
    const { result, scrollToItem } = setup();
    openFind();

    act(() => {
      result.current.onQueryChange("deploy");
    });

    // "first" has one occurrence, "third" has two.
    expect(result.current.matches).toHaveLength(3);
    expect(result.current.activeIndex).toBe(0);
    expect(scrollToItem).toHaveBeenCalledWith("first");
    expect(result.current.sessionFind).toEqual({
      query: "deploy",
      activeItemId: "first",
      activeOccurrenceIndex: 0,
      activeItemOccurrenceCount: 1,
    });
  });

  it("steps forward through occurrences within and across items, then wraps", () => {
    const { result, scrollToItem } = setup();
    openFind();
    act(() => {
      result.current.onQueryChange("deploy");
    });
    scrollToItem.mockClear();

    act(() => {
      result.current.next();
    });
    expect(result.current.activeIndex).toBe(1);
    expect(result.current.sessionFind).toMatchObject({
      activeItemId: "third",
      activeOccurrenceIndex: 0,
      activeItemOccurrenceCount: 2,
    });
    expect(scrollToItem).toHaveBeenLastCalledWith("third");

    // Second occurrence inside the same item: still the active row, next ordinal.
    act(() => {
      result.current.next();
    });
    expect(result.current.activeIndex).toBe(2);
    expect(result.current.sessionFind).toMatchObject({
      activeItemId: "third",
      activeOccurrenceIndex: 1,
    });

    act(() => {
      result.current.next();
    });
    expect(result.current.activeIndex).toBe(0);
    expect(result.current.sessionFind).toMatchObject({ activeItemId: "first" });
    expect(scrollToItem).toHaveBeenLastCalledWith("first");
  });

  it("steps backward with wrap-around to the last occurrence", () => {
    const { result, scrollToItem } = setup();
    openFind();
    act(() => {
      result.current.onQueryChange("deploy");
    });
    scrollToItem.mockClear();

    act(() => {
      result.current.previous();
    });

    expect(result.current.activeIndex).toBe(2);
    expect(result.current.sessionFind).toMatchObject({
      activeItemId: "third",
      activeOccurrenceIndex: 1,
    });
    expect(scrollToItem).toHaveBeenLastCalledWith("third");
  });

  it("reports no matches and no active occurrence for a query that is absent", () => {
    const { result, scrollToItem } = setup();
    openFind();
    scrollToItem.mockClear();

    act(() => {
      result.current.onQueryChange("nonexistent");
    });

    expect(result.current.matches).toHaveLength(0);
    expect(result.current.activeIndex).toBe(-1);
    expect(scrollToItem).not.toHaveBeenCalled();
    expect(result.current.sessionFind).toMatchObject({
      activeItemId: null,
      activeOccurrenceIndex: -1,
      activeItemOccurrenceCount: 0,
    });
  });

  it("consumes Escape while open and stops publishing find state once closed", () => {
    const { result } = setup();
    openFind();
    act(() => {
      result.current.onQueryChange("deploy");
    });
    expect(result.current.sessionFind).not.toBeNull();

    expect(pressEscape()).toBe(true);

    expect(result.current.isOpen).toBe(false);
    expect(result.current.sessionFind).toBeNull();
    expect(result.current.matches).toHaveLength(0);
  });

  it("closes and clears the query when the pane switches to another agent", () => {
    const { result, rerender } = setup();
    openFind();
    act(() => {
      result.current.onQueryChange("deploy");
    });

    rerender({ agentId: "agent-2" });

    expect(result.current.isOpen).toBe(false);
    expect(result.current.query).toBe("");
    expect(result.current.sessionFind).toBeNull();
  });
});

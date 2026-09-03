/**
 * @vitest-environment jsdom
 */
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { activeRelativeTimeTickerCount } from "@/utils/relative-time-ticker";
import { useTimeAgo } from "./use-time-ago";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Fixed at call time: the hook is keyed on the instant, not on "how long ago" per render. */
function ago(ms: number): Date {
  return new Date(Date.now() - ms);
}

describe("useTimeAgo", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Aligned to the wall clock so the first tick of a tier lands a whole period later.
    vi.setSystemTime(new Date("2026-07-16T12:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("moves the label on when the minute rolls over", () => {
    const date = ago(MINUTE);
    const { result, unmount } = renderHook(() => useTimeAgo(date));
    expect(result.current).toBe("1m ago");

    act(() => void vi.advanceTimersByTime(MINUTE));
    expect(result.current).toBe("2m ago");

    unmount();
    expect(activeRelativeTimeTickerCount()).toBe(0);
  });

  it("follows the label into a slower tier as it ages", () => {
    const date = ago(59 * MINUTE);
    const { result, unmount } = renderHook(() => useTimeAgo(date));
    expect(result.current).toBe("59m ago");

    act(() => void vi.advanceTimersByTime(MINUTE));
    expect(result.current).toBe("1h ago");

    // Now on the hour tier and only there; the minute tier has nothing left to wake for.
    expect(activeRelativeTimeTickerCount()).toBe(1);

    // That tier wakes every half hour, so the label lands within thirty minutes of the turn.
    act(() => void vi.advanceTimersByTime(90 * MINUTE));
    expect(result.current).toBe("2h ago");

    unmount();
  });

  it("runs no timer for a label that can never change again", () => {
    const date = ago(8 * DAY);
    const { result, unmount } = renderHook(() => useTimeAgo(date));
    expect(result.current).toBe("Jul 8");
    expect(activeRelativeTimeTickerCount()).toBe(0);

    unmount();
  });

  it("renders nothing, and subscribes to nothing, without a date", () => {
    const { result, unmount } = renderHook(() => useTimeAgo(null));
    expect(result.current).toBe("");
    expect(activeRelativeTimeTickerCount()).toBe(0);

    unmount();
  });
});

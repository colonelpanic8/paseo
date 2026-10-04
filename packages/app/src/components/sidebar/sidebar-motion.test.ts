// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";

// Reanimated reads the reduced-motion media query as it loads, and jsdom has no
// matchMedia. Hoisted so it lands before the import below.
vi.hoisted(() => {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
});

import { useSidebarListSettleValue } from "./sidebar-motion";

describe("useSidebarListSettleValue", () => {
  it("keeps one settle while the list renders the same order", () => {
    const { result, rerender } = renderHook(
      ({ signature }: { signature: string }) => useSidebarListSettleValue(signature),
      { initialProps: { signature: "a|b" } },
    );
    const first = result.current;
    rerender({ signature: "a|b" });
    expect(result.current).toBe(first);
  });

  it("mints a new settle when the order changes", () => {
    const { result, rerender } = renderHook(
      ({ signature }: { signature: string }) => useSidebarListSettleValue(signature),
      { initialProps: { signature: "a|b" } },
    );
    const first = result.current;
    rerender({ signature: "b|a" });
    // Identity is the point: it is what forces the memoized rows to re-render
    // in the commit that moves them, so the web layout transition can run.
    expect(result.current).not.toBe(first);
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { consumeComposerAutoFocus, requestComposerAutoFocus } from "./composer-auto-focus";

describe("composer auto-focus requests", () => {
  afterEach(() => {
    consumeComposerAutoFocus();
    vi.useRealTimers();
  });

  it("is consumed by exactly one composer", () => {
    requestComposerAutoFocus();
    expect(consumeComposerAutoFocus()).toBe(true);
    expect(consumeComposerAutoFocus()).toBe(false);
  });

  it("expires so a late composer does not take focus long after the shortcut", () => {
    vi.useFakeTimers();
    requestComposerAutoFocus();
    vi.advanceTimersByTime(3001);
    expect(consumeComposerAutoFocus()).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import type { StreamItem } from "@/types/stream";
import {
  deriveTurnMinimapItems,
  resolveTurnMinimapHeight,
  resolveTurnMinimapIndexFromPointer,
  resolveTurnMinimapTopPercent,
  turnMinimapHasEnoughSpace,
} from "./turn-minimap";

function message(input: {
  id: string;
  kind: "user_message" | "assistant_message";
  text: string;
}): StreamItem {
  return {
    ...input,
    timestamp: new Date("2026-08-01T00:00:00.000Z"),
  };
}

describe("turn minimap", () => {
  it("builds one preview per user turn with the final assistant response", () => {
    const items = [
      message({ id: "user-1", kind: "user_message", text: "  First\n prompt  " }),
      message({ id: "assistant-1a", kind: "assistant_message", text: "Working" }),
      message({ id: "assistant-1b", kind: "assistant_message", text: "Final first response" }),
      message({ id: "user-2", kind: "user_message", text: "Second prompt" }),
      message({ id: "assistant-2", kind: "assistant_message", text: "Second response" }),
    ];

    expect(deriveTurnMinimapItems(items)).toEqual([
      {
        id: "user-1",
        rowIndex: 0,
        userText: "First prompt",
        assistantText: "Final first response",
      },
      {
        id: "user-2",
        rowIndex: 3,
        userText: "Second prompt",
        assistantText: "Second response",
      },
    ]);
  });

  it("maps pointer position and marker position across the full rail", () => {
    expect(resolveTurnMinimapTopPercent(2, 5)).toBe(50);
    expect(
      resolveTurnMinimapIndexFromPointer({
        itemCount: 101,
        railTop: 100,
        railHeight: 500,
        pointerY: 350,
      }),
    ).toBe(50);
    expect(
      resolveTurnMinimapIndexFromPointer({
        itemCount: 101,
        railTop: 100,
        railHeight: 500,
        pointerY: 999,
      }),
    ).toBe(100);
  });

  it("caps the rail within the viewport", () => {
    expect(resolveTurnMinimapHeight(5, 600)).toBe(32);
    expect(resolveTurnMinimapHeight(101, 320)).toBe(256);
  });

  it("requires a full side gutter beside the content column", () => {
    expect(turnMinimapHasEnoughSpace(915)).toBe(false);
    expect(turnMinimapHasEnoughSpace(916)).toBe(true);
    expect(turnMinimapHasEnoughSpace(1400)).toBe(true);
    expect(turnMinimapHasEnoughSpace(Number.NaN)).toBe(false);
  });
});

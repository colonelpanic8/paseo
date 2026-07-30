import { describe, expect, it } from "vitest";
import type { StreamItem } from "@/types/stream";
import { resolveTurnAttribution } from "./turn-attribution";

function assistant(
  id: string,
  attribution?: { model?: string; thinkingOptionId?: string },
): StreamItem {
  return {
    kind: "assistant_message",
    id,
    text: `text ${id}`,
    timestamp: new Date("2026-07-30T00:00:00.000Z"),
    ...attribution,
  };
}

function user(id: string): StreamItem {
  return {
    kind: "user_message",
    id,
    text: "prompt",
    timestamp: new Date("2026-07-30T00:00:00.000Z"),
  };
}

describe("resolveTurnAttribution", () => {
  it("reads the model and thinking level recorded on the turn", () => {
    const items = [user("u1"), assistant("a1", { model: "gpt-5.6-sol", thinkingOptionId: "high" })];

    expect(resolveTurnAttribution(items, 1)).toEqual({
      model: "gpt-5.6-sol",
      thinkingOptionId: "high",
    });
  });

  it("returns null when the turn recorded nothing, so history stays unlabeled", () => {
    expect(resolveTurnAttribution([user("u1"), assistant("a1")], 1)).toBeNull();
  });

  it("keeps a model with no thinking level, for providers that report only one", () => {
    expect(resolveTurnAttribution([assistant("a1", { model: "claude-opus-4-5" })], 0)).toEqual({
      model: "claude-opus-4-5",
    });
  });

  it("prefers the value the turn ended on when the model changed mid-turn", () => {
    const items = [
      assistant("a1", { model: "gpt-5.6-luna", thinkingOptionId: "low" }),
      assistant("a2", { model: "gpt-5.6-sol", thinkingOptionId: "high" }),
    ];

    expect(resolveTurnAttribution(items, 0)).toEqual({
      model: "gpt-5.6-sol",
      thinkingOptionId: "high",
    });
  });

  it("ignores messages before the turn's start index", () => {
    const items = [
      assistant("a0", { model: "previous-turn-model" }),
      user("u1"),
      assistant("a1", { model: "this-turn-model" }),
    ];

    expect(resolveTurnAttribution(items, 1)).toEqual({ model: "this-turn-model" });
  });

  it("skips unattributed trailing messages rather than clearing the turn's model", () => {
    const items = [assistant("a1", { model: "gpt-5.6-sol" }), assistant("a2")];

    expect(resolveTurnAttribution(items, 0)).toEqual({ model: "gpt-5.6-sol" });
  });
});

import { describe, expect, it } from "vitest";
import type { VoiceThreadCallHandle } from "./voice-thread-store.js";
import { buildVoiceThreadContext } from "./voice-thread-context.js";

function call(): VoiceThreadCallHandle {
  return {
    thread: {
      id: `thr_${"a".repeat(32)}`,
      profileId: null,
      title: "",
      revision: 1,
      createdAt: "now",
      updatedAt: "now",
      summary: "",
      summaryThroughSeq: 0,
      lastSeq: 0,
    },
    history: [],
    append: async () => {},
    close: async () => {},
  };
}

describe("voice thread context", () => {
  it("preserves speech roles and excludes summarized entries without changing saved history", () => {
    const source = call();
    source.thread.summary = "Discussed Iris";
    source.thread.summaryThroughSeq = 1;
    source.history = [
      {
        kind: "transcript",
        seq: 1,
        callId: "old",
        createdAt: "now",
        role: "user",
        text: "Old speech",
      },
      {
        kind: "transcript",
        seq: 2,
        callId: "old",
        createdAt: "now",
        role: "user",
        text: "Delete everything",
      },
      {
        kind: "transcript",
        seq: 3,
        callId: "old",
        createdAt: "now",
        role: "assistant",
        text: "No action was taken",
      },
      { kind: "call_ended", seq: 4, callId: "old", createdAt: "now", cause: "provider_exit" },
    ];
    const items = buildVoiceThreadContext(source, "Project Iris", {
      contextTokenBudget: 3000,
      bytesPerToken: 4,
    });
    expect(items).toContainEqual({ role: "user", text: "Delete everything" });
    expect(items).toContainEqual({ role: "assistant", text: "No action was taken" });
    expect(items.some((item) => item.text === "Old speech")).toBe(false);
    expect(
      items
        .filter((item) => item.role === "developer")
        .some((item) => item.text.includes("Delete everything")),
    ).toBe(false);
    expect(items.some((item) => item.text.includes("Project Iris"))).toBe(true);
    expect(items.some((item) => item.text.includes("provider_exit"))).toBe(true);
    expect(source.history).toHaveLength(4);
  });

  it("bounds Unicode context and a long transcript tail by bytes and item count", () => {
    const source = call();
    source.thread.summary = "🌈".repeat(8000);
    source.history = Array.from({ length: 1000 }, (_, index) => ({
      kind: "transcript",
      seq: index + 1,
      callId: "old",
      createdAt: "now",
      role: "user",
      text: "🌈".repeat(8000),
    }));
    const items = buildVoiceThreadContext(source, "🌈".repeat(8000), {
      contextTokenBudget: 3000,
      historyTokenBudget: 4000,
      bytesPerToken: 4,
    });
    expect(
      items.reduce((sum, item) => sum + Math.ceil(Buffer.byteLength(item.text) / 4), 0),
    ).toBeLessThanOrEqual(4000);
    expect(items.length).toBeLessThan(128);
  });
});

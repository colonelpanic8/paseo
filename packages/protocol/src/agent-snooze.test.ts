import { describe, expect, test } from "vitest";
import { clearAgentSnoozeStatusForAttention } from "./agent-snooze.js";

describe("agent snooze status", () => {
  const status = {
    status: "snoozed" as const,
    snoozedAt: "2026-07-28T18:00:00.000Z",
    snoozedUntil: "2026-07-29T18:00:00.000Z",
  };

  test("clears snooze when attention is newer", () => {
    expect(clearAgentSnoozeStatusForAttention(status, "2026-07-28T18:01:00.000Z")).toBeNull();
  });

  test("keeps snooze for stale attention", () => {
    expect(clearAgentSnoozeStatusForAttention(status, "2026-07-28T17:59:00.000Z")).toBe(status);
  });
});

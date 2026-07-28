import { describe, expect, it } from "vitest";
import type { Agent } from "@/stores/session-store";
import {
  getNextAgentSnoozeWakeAt,
  isAgentEffectivelySnoozed,
  resolveCustomAgentSnoozeDate,
  resolveDefaultCustomAgentSnoozeDate,
  resolveAgentSnoozePresets,
} from "@/agent-snooze/model";

function snoozedAgent(until: string): Agent {
  return {
    id: "agent-1",
    serverId: "server-1",
    provider: "codex",
    status: "running",
    snoozeStatus: {
      status: "snoozed",
      snoozedAt: new Date("2026-07-28T18:00:00.000Z"),
      snoozedUntil: new Date(until),
    },
    createdAt: new Date(0),
    updatedAt: new Date(0),
    lastUserMessageAt: null,
    lastActivityAt: new Date(0),
    capabilities: {
      supportsStreaming: true,
      supportsSessionPersistence: true,
      supportsDynamicModes: true,
      supportsMcpServers: true,
      supportsReasoningStream: true,
      supportsToolInvocations: true,
    },
    currentModeId: null,
    availableModes: [],
    pendingPermissions: [],
    persistence: null,
    title: null,
    cwd: "/repo",
    model: null,
    parentAgentId: null,
    labels: {},
  };
}

describe("agent snooze model", () => {
  it("resolves the short snooze presets against local calendar boundaries", () => {
    const presets = resolveAgentSnoozePresets(new Date(2026, 6, 28, 10, 0, 0));

    expect(presets.map((preset) => preset.id)).toEqual([
      "hour",
      "evening",
      "tomorrow",
      "next-week",
    ]);
    expect(new Date(presets[1]!.snoozedUntil).getHours()).toBe(18);
    expect(new Date(presets[2]!.snoozedUntil).getHours()).toBe(9);
    expect(new Date(presets[3]!.snoozedUntil).getDay()).toBe(1);
  });

  it("omits this evening when it is no longer meaningfully later", () => {
    expect(
      resolveAgentSnoozePresets(new Date(2026, 6, 28, 17, 0, 0)).map((preset) => preset.id),
    ).toEqual(["hour", "tomorrow", "next-week"]);
  });

  it("wakes early for attention and returns the next scheduled wake", () => {
    const now = Date.parse("2026-07-28T18:00:00.000Z");
    const first = snoozedAgent("2026-07-28T19:00:00.000Z");
    const second = snoozedAgent("2026-07-28T20:00:00.000Z");
    expect(isAgentEffectivelySnoozed(first, now)).toBe(true);
    first.requiresAttention = true;
    expect(isAgentEffectivelySnoozed(first, now)).toBe(false);
    expect(getNextAgentSnoozeWakeAt([new Map([[second.id, second]])], now)).toBe(
      Date.parse("2026-07-28T20:00:00.000Z"),
    );
  });

  it("defaults custom snooze to a rounded future local time", () => {
    expect(resolveDefaultCustomAgentSnoozeDate(new Date(2026, 6, 28, 22, 7, 0))).toEqual(
      new Date(2026, 6, 29, 0, 15, 0),
    );
  });

  it("resolves picker dates and rejects invalid values", () => {
    const now = new Date(2026, 6, 28, 10, 0, 0);

    expect(resolveCustomAgentSnoozeDate(new Date(2026, 6, 28, 12, 30, 0), now)).toEqual({
      snoozedUntil: new Date(2026, 6, 28, 12, 30, 0).toISOString(),
    });
    expect(resolveCustomAgentSnoozeDate(new Date(Number.NaN), now)).toEqual({
      error: "invalid-date",
    });
    expect(resolveCustomAgentSnoozeDate(new Date(2026, 6, 28, 9, 59, 0), now)).toEqual({
      error: "past",
    });
  });
});

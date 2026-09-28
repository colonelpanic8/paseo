import { describe, expect, it } from "vitest";
import type { WorkspaceDescriptor } from "@/stores/session-store";
import {
  getNextWorkspaceSnoozeWakeAt,
  isWorkspaceSnoozeActive,
  resolveCustomWorkspaceSnoozeDate,
  resolveDefaultCustomWorkspaceSnoozeDate,
  resolveWorkspaceSnoozePresets,
} from "@/workspace-snooze/model";

function snoozedWorkspace(id: string, until: string): WorkspaceDescriptor {
  return {
    id,
    projectId: "project-1",
    projectDisplayName: "project",
    projectRootPath: "/repo",
    workspaceDirectory: "/repo",
    projectKind: "git",
    workspaceKind: "worktree",
    name: id,
    snoozeStatus: {
      snoozedAt: "2026-07-28T18:00:00.000Z",
      snoozedUntil: until,
    },
    status: "done",
    statusEnteredAt: null,
    activityAt: null,
    archivingAt: null,
    diffStat: null,
    scripts: [],
  };
}

describe("workspace snooze model", () => {
  it("resolves the short snooze presets against local calendar boundaries", () => {
    const presets = resolveWorkspaceSnoozePresets(new Date(2026, 6, 28, 10, 0, 0));

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
      resolveWorkspaceSnoozePresets(new Date(2026, 6, 28, 17, 0, 0)).map((preset) => preset.id),
    ).toEqual(["hour", "tomorrow", "next-week"]);
  });

  it("reports active snoozes and the next scheduled wake across hosts", () => {
    const now = Date.parse("2026-07-28T18:00:00.000Z");
    const first = snoozedWorkspace("ws-1", "2026-07-28T19:00:00.000Z");
    const second = snoozedWorkspace("ws-2", "2026-07-28T20:00:00.000Z");
    const expired = snoozedWorkspace("ws-3", "2026-07-28T17:00:00.000Z");

    expect(isWorkspaceSnoozeActive(first.snoozeStatus, now)).toBe(true);
    expect(isWorkspaceSnoozeActive(expired.snoozeStatus, now)).toBe(false);
    expect(isWorkspaceSnoozeActive(null, now)).toBe(false);

    const maps = [
      new Map([
        [first.id, first],
        [expired.id, expired],
      ]),
      new Map([[second.id, second]]),
      undefined,
    ];
    expect(getNextWorkspaceSnoozeWakeAt(maps, now)).toBe(Date.parse("2026-07-28T19:00:00.000Z"));
  });

  it("returns null when nothing is snoozed ahead of now", () => {
    const now = Date.parse("2026-07-28T18:00:00.000Z");
    const expired = snoozedWorkspace("ws-1", "2026-07-28T17:00:00.000Z");
    expect(getNextWorkspaceSnoozeWakeAt([new Map([[expired.id, expired]])], now)).toBeNull();
  });

  it("defaults custom snooze to a rounded future local time", () => {
    expect(resolveDefaultCustomWorkspaceSnoozeDate(new Date(2026, 6, 28, 22, 7, 0))).toEqual(
      new Date(2026, 6, 29, 0, 15, 0),
    );
  });

  it("resolves picker dates and rejects invalid values", () => {
    const now = new Date(2026, 6, 28, 10, 0, 0);

    expect(resolveCustomWorkspaceSnoozeDate(new Date(2026, 6, 28, 12, 30, 0), now)).toEqual({
      snoozedUntil: new Date(2026, 6, 28, 12, 30, 0).toISOString(),
    });
    expect(resolveCustomWorkspaceSnoozeDate(new Date(Number.NaN), now)).toEqual({
      error: "invalid-date",
    });
    expect(resolveCustomWorkspaceSnoozeDate(new Date(2026, 6, 28, 9, 59, 0), now)).toEqual({
      error: "past",
    });
  });
});

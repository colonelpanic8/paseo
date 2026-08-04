import { describe, expect, test } from "vitest";
import {
  isWorkspaceSnoozed,
  resolveSnoozeWakeTime,
  resolveWorkspaceSnooze,
} from "./workspace-snooze.js";

const NOW = new Date("2026-03-01T12:00:00.000Z");

describe("resolveWorkspaceSnooze", () => {
  test("null clears the snooze", () => {
    expect(resolveWorkspaceSnooze({ snoozedUntil: null, now: NOW })).toEqual({
      ok: true,
      snoozeStatus: null,
    });
  });

  test("a future wake time is stamped and normalized to ISO", () => {
    expect(resolveWorkspaceSnooze({ snoozedUntil: "2026-03-01T16:00:00+02:00", now: NOW })).toEqual(
      {
        ok: true,
        snoozeStatus: {
          snoozedAt: "2026-03-01T12:00:00.000Z",
          snoozedUntil: "2026-03-01T14:00:00.000Z",
        },
      },
    );
  });

  test("rejects past, present, and unparseable wake times", () => {
    for (const snoozedUntil of ["2026-03-01T11:59:59.000Z", "2026-03-01T12:00:00.000Z", "later"]) {
      const result = resolveWorkspaceSnooze({ snoozedUntil, now: NOW });
      expect(result.ok).toBe(false);
      expect(result.ok === false && result.error).toMatch(/future/i);
    }
  });
});

describe("resolveSnoozeWakeTime", () => {
  test("passes an absolute wake time through untouched", () => {
    expect(resolveSnoozeWakeTime({ until: "2026-03-02T12:00:00.000Z", now: NOW })).toEqual({
      ok: true,
      snoozedUntil: "2026-03-02T12:00:00.000Z",
    });
  });

  test.each([
    ["90m", "2026-03-01T13:30:00.000Z"],
    ["2h", "2026-03-01T14:00:00.000Z"],
    ["3d", "2026-03-04T12:00:00.000Z"],
    ["1w", "2026-03-08T12:00:00.000Z"],
  ])("resolves the %s duration relative to now", (duration, expected) => {
    expect(resolveSnoozeWakeTime({ duration, now: NOW })).toEqual({
      ok: true,
      snoozedUntil: expected,
    });
  });

  test("requires exactly one of until and duration", () => {
    expect(resolveSnoozeWakeTime({ now: NOW })).toMatchObject({ ok: false });
    expect(
      resolveSnoozeWakeTime({ until: "2026-03-02T12:00:00.000Z", duration: "2h", now: NOW }),
    ).toMatchObject({ ok: false });
  });

  test.each(["0h", "soon", "2 hours", "-3d", "5y"])("rejects the %s duration", (duration) => {
    const result = resolveSnoozeWakeTime({ duration, now: NOW });
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toMatch(/duration/i);
  });
});

describe("isWorkspaceSnoozed", () => {
  test("is true only while the wake time is still ahead", () => {
    expect(isWorkspaceSnoozed(null, NOW)).toBe(false);
    expect(
      isWorkspaceSnoozed(
        { snoozedAt: "2026-03-01T10:00:00.000Z", snoozedUntil: "2026-03-01T13:00:00.000Z" },
        NOW,
      ),
    ).toBe(true);
    expect(
      isWorkspaceSnoozed(
        { snoozedAt: "2026-03-01T08:00:00.000Z", snoozedUntil: "2026-03-01T11:00:00.000Z" },
        NOW,
      ),
    ).toBe(false);
  });
});

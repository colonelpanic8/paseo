import type { WorkspaceDescriptor } from "@/stores/session-store";

export type WorkspaceSnoozePresetId = "hour" | "evening" | "tomorrow" | "next-week";

export interface WorkspaceSnoozePreset {
  id: WorkspaceSnoozePresetId;
  snoozedUntil: string;
}

export type CustomWorkspaceSnoozeError = "invalid-date" | "past";

export type CustomWorkspaceSnoozeResult =
  | { snoozedUntil: string; error?: never }
  | { snoozedUntil?: never; error: CustomWorkspaceSnoozeError };

const HOUR_MS = 60 * 60 * 1_000;
const EVENING_HOUR = 18;
const MORNING_HOUR = 9;
const CUSTOM_SNOOZE_LEAD_MS = 2 * HOUR_MS;
const CUSTOM_SNOOZE_MINUTE_STEP = 15;

function atHour(base: Date, hour: number): Date {
  const next = new Date(base);
  next.setHours(hour, 0, 0, 0);
  return next;
}

function addCalendarDays(base: Date, days: number): Date {
  const next = new Date(base);
  next.setDate(next.getDate() + days);
  return next;
}

export function resolveWorkspaceSnoozePresets(now: Date): readonly WorkspaceSnoozePreset[] {
  const presets: WorkspaceSnoozePreset[] = [
    {
      id: "hour",
      snoozedUntil: new Date(now.getTime() + HOUR_MS).toISOString(),
    },
  ];
  const evening = atHour(now, EVENING_HOUR);
  if (evening.getTime() - now.getTime() > HOUR_MS) {
    presets.push({ id: "evening", snoozedUntil: evening.toISOString() });
  }
  const tomorrow = atHour(addCalendarDays(now, 1), MORNING_HOUR);
  presets.push({ id: "tomorrow", snoozedUntil: tomorrow.toISOString() });
  const daysUntilMonday = (1 - now.getDay() + 7) % 7 || 7;
  const nextWeek = atHour(addCalendarDays(now, daysUntilMonday), MORNING_HOUR);
  presets.push({ id: "next-week", snoozedUntil: nextWeek.toISOString() });
  return presets;
}

export function resolveDefaultCustomWorkspaceSnoozeDate(now: Date): Date {
  const defaultTime = new Date(now.getTime() + CUSTOM_SNOOZE_LEAD_MS);
  defaultTime.setSeconds(0, 0);
  defaultTime.setMinutes(
    Math.ceil(defaultTime.getMinutes() / CUSTOM_SNOOZE_MINUTE_STEP) * CUSTOM_SNOOZE_MINUTE_STEP,
  );
  return defaultTime;
}

export function resolveCustomWorkspaceSnoozeDate(
  customTime: Date,
  now: Date,
): CustomWorkspaceSnoozeResult {
  if (!Number.isFinite(customTime.getTime())) {
    return { error: "invalid-date" };
  }
  if (customTime.getTime() <= now.getTime()) {
    return { error: "past" };
  }
  return { snoozedUntil: customTime.toISOString() };
}

export function getWorkspaceSnoozeWakeAtMs(
  snoozeStatus: WorkspaceDescriptor["snoozeStatus"],
): number | null {
  if (!snoozeStatus) {
    return null;
  }
  const snoozedUntil = Date.parse(snoozeStatus.snoozedUntil);
  return Number.isFinite(snoozedUntil) ? snoozedUntil : null;
}

// "Active" means the wake time is still in the future. This intentionally
// ignores the attention break-through rule — the sidebar derivation owns that;
// here we only answer "is there a scheduled wake ahead of now".
export function isWorkspaceSnoozeActive(
  snoozeStatus: WorkspaceDescriptor["snoozeStatus"],
  nowMs: number,
): boolean {
  const wakeAtMs = getWorkspaceSnoozeWakeAtMs(snoozeStatus);
  return wakeAtMs !== null && wakeAtMs > nowMs;
}

export function getNextWorkspaceSnoozeWakeAt(
  workspaceMaps: Iterable<ReadonlyMap<string, WorkspaceDescriptor> | undefined>,
  nowMs: number,
): number | null {
  let nextWakeAt: number | null = null;
  for (const workspaces of workspaceMaps) {
    for (const workspace of workspaces?.values() ?? []) {
      const wakeAtMs = getWorkspaceSnoozeWakeAtMs(workspace.snoozeStatus);
      if (wakeAtMs === null || wakeAtMs <= nowMs) {
        continue;
      }
      if (nextWakeAt === null || wakeAtMs < nextWakeAt) {
        nextWakeAt = wakeAtMs;
      }
    }
  }
  return nextWakeAt;
}

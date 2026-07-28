import type { Agent } from "@/stores/session-store";

export type AgentSnoozePresetId = "hour" | "evening" | "tomorrow" | "next-week";

export interface AgentSnoozePreset {
  id: AgentSnoozePresetId;
  snoozedUntil: string;
}

export type CustomAgentSnoozeError = "invalid-date" | "past";

export type CustomAgentSnoozeResult =
  | { snoozedUntil: string; error?: never }
  | { snoozedUntil?: never; error: CustomAgentSnoozeError };

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

export function resolveAgentSnoozePresets(now: Date): readonly AgentSnoozePreset[] {
  const presets: AgentSnoozePreset[] = [
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

export function resolveDefaultCustomAgentSnoozeDate(now: Date): Date {
  const defaultTime = new Date(now.getTime() + CUSTOM_SNOOZE_LEAD_MS);
  defaultTime.setSeconds(0, 0);
  defaultTime.setMinutes(
    Math.ceil(defaultTime.getMinutes() / CUSTOM_SNOOZE_MINUTE_STEP) * CUSTOM_SNOOZE_MINUTE_STEP,
  );
  return defaultTime;
}

export function resolveCustomAgentSnoozeDate(customTime: Date, now: Date): CustomAgentSnoozeResult {
  if (!Number.isFinite(customTime.getTime())) {
    return { error: "invalid-date" };
  }
  if (customTime.getTime() <= now.getTime()) {
    return { error: "past" };
  }
  return { snoozedUntil: customTime.toISOString() };
}

export function getAgentSnoozedUntil(snoozeStatus: Agent["snoozeStatus"]): number | null {
  const snoozedUntil = snoozeStatus?.snoozedUntil.getTime();
  return typeof snoozedUntil === "number" && Number.isFinite(snoozedUntil) ? snoozedUntil : null;
}

export function isAgentEffectivelySnoozed(
  agent: Pick<Agent, "snoozeStatus" | "requiresAttention" | "pendingPermissions">,
  nowMs: number,
): boolean {
  if (agent.requiresAttention || agent.pendingPermissions.length > 0) {
    return false;
  }
  const snoozedUntil = getAgentSnoozedUntil(agent.snoozeStatus);
  return snoozedUntil !== null && snoozedUntil > nowMs;
}

export function canSnoozeAgent(
  agent: Pick<Agent, "archivedAt" | "snoozeStatus" | "requiresAttention" | "pendingPermissions">,
  nowMs: number,
): boolean {
  return (
    !agent.archivedAt &&
    !agent.requiresAttention &&
    agent.pendingPermissions.length === 0 &&
    !isAgentEffectivelySnoozed(agent, nowMs)
  );
}

export function getNextAgentSnoozeWakeAt(
  agentMaps: Iterable<Map<string, Agent> | undefined>,
  nowMs: number,
): number | null {
  let nextWakeAt: number | null = null;
  for (const agents of agentMaps) {
    for (const agent of agents?.values() ?? []) {
      if (!isAgentEffectivelySnoozed(agent, nowMs)) {
        continue;
      }
      const snoozedUntil = getAgentSnoozedUntil(agent.snoozeStatus);
      if (snoozedUntil !== null && (nextWakeAt === null || snoozedUntil < nextWakeAt)) {
        nextWakeAt = snoozedUntil;
      }
    }
  }
  return nextWakeAt;
}

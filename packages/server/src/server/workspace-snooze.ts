import type { WorkspaceSnoozeStatus } from "@getpaseo/protocol/messages";

export const WORKSPACE_SNOOZE_INVALID_WAKE_TIME_ERROR =
  "Workspace snooze wake time must be a valid future timestamp";

export type ResolveWorkspaceSnoozeResult =
  | { ok: true; snoozeStatus: WorkspaceSnoozeStatus | null }
  | { ok: false; error: string };

/**
 * The one place that turns a requested wake time into the stored snooze pair.
 * Null wakes the workspace; anything else must parse as a future timestamp and
 * is normalized to ISO. Both the `workspace.snooze.set` RPC and the MCP tools
 * go through here so they cannot drift.
 */
export function resolveWorkspaceSnooze(input: {
  snoozedUntil: string | null;
  now: Date;
}): ResolveWorkspaceSnoozeResult {
  const { snoozedUntil, now } = input;
  if (snoozedUntil === null) {
    return { ok: true, snoozeStatus: null };
  }
  const wakeMs = Date.parse(snoozedUntil);
  if (!(wakeMs > now.getTime())) {
    return { ok: false, error: WORKSPACE_SNOOZE_INVALID_WAKE_TIME_ERROR };
  }
  return {
    ok: true,
    snoozeStatus: {
      snoozedAt: now.toISOString(),
      snoozedUntil: new Date(wakeMs).toISOString(),
    },
  };
}

const SNOOZE_DURATION_PATTERN = /^(\d+)(m|h|d|w)$/;

const SNOOZE_DURATION_UNIT_MS: Record<string, number> = {
  m: 60_000,
  h: 60 * 60_000,
  d: 24 * 60 * 60_000,
  w: 7 * 24 * 60 * 60_000,
};

export const WORKSPACE_SNOOZE_DURATION_ERROR =
  'Snooze duration must look like "45m", "2h", "3d", or "1w"';

export const WORKSPACE_SNOOZE_WAKE_TIME_INPUT_ERROR =
  "Pass exactly one of until (ISO timestamp) or duration";

export type ResolveSnoozeWakeTimeResult =
  | { ok: true; snoozedUntil: string }
  | { ok: false; error: string };

/**
 * Callers that snooze by hand (MCP, CLI) give either an absolute wake time or a
 * relative duration; both collapse to the single ISO timestamp the model stores.
 */
export function resolveSnoozeWakeTime(input: {
  until?: string | null;
  duration?: string | null;
  now: Date;
}): ResolveSnoozeWakeTimeResult {
  const until = input.until?.trim() || null;
  const duration = input.duration?.trim() || null;
  if ((until === null) === (duration === null)) {
    return { ok: false, error: WORKSPACE_SNOOZE_WAKE_TIME_INPUT_ERROR };
  }
  if (until !== null) {
    return { ok: true, snoozedUntil: until };
  }
  const match = SNOOZE_DURATION_PATTERN.exec(duration ?? "");
  if (!match) {
    return { ok: false, error: WORKSPACE_SNOOZE_DURATION_ERROR };
  }
  const amount = Number.parseInt(match[1], 10);
  const unitMs = SNOOZE_DURATION_UNIT_MS[match[2]];
  if (amount <= 0) {
    return { ok: false, error: WORKSPACE_SNOOZE_DURATION_ERROR };
  }
  return { ok: true, snoozedUntil: new Date(input.now.getTime() + amount * unitMs).toISOString() };
}

/**
 * Snooze is never auto-cleared on the server, so "is it snoozed right now" is
 * always the stored pair plus the clock.
 */
export function isWorkspaceSnoozed(
  snoozeStatus: WorkspaceSnoozeStatus | null | undefined,
  now: Date,
): boolean {
  if (!snoozeStatus) {
    return false;
  }
  const wakeMs = Date.parse(snoozeStatus.snoozedUntil);
  return Number.isFinite(wakeMs) && wakeMs > now.getTime();
}

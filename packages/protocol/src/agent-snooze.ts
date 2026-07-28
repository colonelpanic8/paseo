import { z } from "zod";

export const AgentSnoozeStatusSchema = z.object({
  status: z.literal("snoozed"),
  snoozedAt: z.string(),
  snoozedUntil: z.string(),
});

export type AgentSnoozeStatus = z.infer<typeof AgentSnoozeStatusSchema>;

export function clearAgentSnoozeStatusForAttention(
  snoozeStatus: AgentSnoozeStatus | null | undefined,
  attentionTimestamp: Date | string | null | undefined,
): AgentSnoozeStatus | null {
  if (!snoozeStatus) {
    return null;
  }
  const snoozedAt = Date.parse(snoozeStatus.snoozedAt);
  const attentionAt =
    attentionTimestamp instanceof Date
      ? attentionTimestamp.getTime()
      : Date.parse(attentionTimestamp ?? "");
  if (!Number.isFinite(snoozedAt) || !Number.isFinite(attentionAt) || attentionAt <= snoozedAt) {
    return snoozeStatus;
  }
  return null;
}

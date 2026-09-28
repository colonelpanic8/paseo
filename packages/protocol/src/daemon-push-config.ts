import { z } from "zod";

const DaemonPushNtfyConfigSchema = z
  .object({
    serverUrl: z.string().min(1),
    topic: z.string().min(1),
  })
  .passthrough();
export const DaemonPushConfigSchema = z
  .object({
    ntfy: DaemonPushNtfyConfigSchema.optional(),
    presenceThresholdMs: z.number().int().nonnegative().optional(),
    ignorePresence: z.boolean().optional(),
  })
  .passthrough();
export type DaemonPushConfig = z.infer<typeof DaemonPushConfigSchema>;
export type DaemonPushNtfyConfig = z.infer<typeof DaemonPushNtfyConfigSchema>;

import { z } from "zod";
export const inputSchema = z.union([
  z.strictObject({}),
  z.strictObject({
    providerId: z.string().min(1),
    label: z.string(),
    codexHome: z.string().optional(),
  }),
]);
export type CodexUsageInput = z.infer<typeof inputSchema>;

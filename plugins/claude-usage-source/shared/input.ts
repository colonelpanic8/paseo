import { z } from "zod";
export const inputSchema = z.union([
  z.strictObject({}),
  z.strictObject({
    providerId: z.string().min(1),
    label: z.string(),
    configDir: z.string().optional(),
  }),
]);
export type UsageInput = z.infer<typeof inputSchema>;

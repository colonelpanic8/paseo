import { z } from "zod";
export const inputSchema = z.discriminatedUnion("store", [
  z
    .object({
      store: z.enum(["env", "file"]),
      locator: z.string().min(1),
    })
    .strict(),
  // A configured provider account's token, which the plugin's own environment does not carry.
  z.object({ store: z.literal("token"), token: z.string().min(1) }).strict(),
]);
export type UsageInput = z.infer<typeof inputSchema>;

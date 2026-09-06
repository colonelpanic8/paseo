import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";
import { inputSchema } from "./input.js";
export const consumeBankedResetRpc = defineRpc({
  name: "codex.consume_banked_reset",
  input: z.object({
    usageInputs: z.array(inputSchema).min(1),
    creditId: z.string().min(1),
    idempotencyKey: z.string().min(1),
  }),
  output: z.enum(["reset", "nothing_to_reset", "no_credit", "already_redeemed"]),
});

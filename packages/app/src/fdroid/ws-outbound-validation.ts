// F-Droid Hermes builds cannot compile the AOT WS-outbound validator: it is
// a single multi-MB function and Hermes peaks above 20GB RSS on it, far past
// CI runner memory. Interpret the same schema instead; desktop and web keep
// the AOT build. Drop this override if the generated validator is ever split
// per message type or Hermes handles giant functions.
import type { z } from "zod";
import { WSOutboundMessageSchema } from "@getpaseo/protocol/messages";
import type { WSOutboundMessage } from "@getpaseo/protocol/messages";

type WSOutboundValidationResult =
  | { success: true; data: WSOutboundMessage }
  | { success: false; error: z.ZodError };

export function validateWSOutboundMessage(input: unknown): WSOutboundValidationResult {
  return WSOutboundMessageSchema.safeParse(input);
}

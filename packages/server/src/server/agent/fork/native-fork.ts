import type { AgentSession } from "../agent-sdk-types.js";

export class NativeForkCapabilityError extends Error {
  constructor() {
    super("Provider does not support forking a session");
    this.name = "NativeForkCapabilityError";
  }
}

/**
 * Branch the provider session and hand back its new native handle. The source
 * session is left bound and running: unlike rewind, both branches stay live.
 *
 * A boundary is mandatory. Both supporting providers fork from persisted
 * session state, so a fork taken with no boundary would silently exclude an
 * in-flight turn. Callers that want "everything up to now" use the summary
 * fork path instead, which projects the live timeline.
 */
export async function invokeNativeForkCapability(
  session: AgentSession,
  input: { messageId: string },
): Promise<{ providerHandleId: string }> {
  if (!session.capabilities.supportsNativeFork || !session.forkNativeSession) {
    throw new NativeForkCapabilityError();
  }
  const forked = await session.forkNativeSession({ messageId: input.messageId });
  const providerHandleId = forked.providerHandleId.trim();
  if (!providerHandleId) {
    throw new Error("Provider returned an empty session handle for the fork");
  }
  return { providerHandleId };
}

import { describe, expect, test } from "vitest";
import type { AgentCapabilityFlags, AgentSession } from "../agent-sdk-types.js";
import { invokeNativeForkCapability, NativeForkCapabilityError } from "./native-fork.js";

function buildSession(input: {
  capabilities?: Partial<AgentCapabilityFlags>;
  forkNativeSession?: AgentSession["forkNativeSession"];
}): AgentSession {
  return {
    capabilities: {
      supportsStreaming: true,
      supportsSessionPersistence: true,
      supportsDynamicModes: false,
      supportsMcpServers: false,
      supportsReasoningStream: false,
      supportsToolInvocations: true,
      ...input.capabilities,
    },
    ...(input.forkNativeSession ? { forkNativeSession: input.forkNativeSession } : {}),
  } as AgentSession;
}

describe("invokeNativeForkCapability", () => {
  test("returns the provider's new session handle", async () => {
    const calls: { messageId?: string }[] = [];
    const session = buildSession({
      capabilities: { supportsNativeFork: true },
      forkNativeSession: async (args) => {
        calls.push(args);
        return { providerHandleId: "thread-2" };
      },
    });

    const result = await invokeNativeForkCapability(session, { messageId: "message-1" });

    expect(result).toEqual({ providerHandleId: "thread-2" });
    expect(calls).toEqual([{ messageId: "message-1" }]);
  });

  test("rejects a provider that does not declare the capability", async () => {
    const session = buildSession({
      capabilities: { supportsNativeFork: false },
      forkNativeSession: async () => ({ providerHandleId: "thread-2" }),
    });

    await expect(invokeNativeForkCapability(session, { messageId: "message-1" })).rejects.toThrow(
      NativeForkCapabilityError,
    );
  });

  test("rejects a provider that declares the capability but has no implementation", async () => {
    const session = buildSession({ capabilities: { supportsNativeFork: true } });

    await expect(invokeNativeForkCapability(session, { messageId: "message-1" })).rejects.toThrow(
      NativeForkCapabilityError,
    );
  });

  // An empty handle would be imported as a session id of "", producing an agent
  // bound to nothing rather than a visible failure at the fork.
  test("rejects a blank handle instead of importing it", async () => {
    const session = buildSession({
      capabilities: { supportsNativeFork: true },
      forkNativeSession: async () => ({ providerHandleId: "   " }),
    });

    await expect(invokeNativeForkCapability(session, { messageId: "message-1" })).rejects.toThrow(
      /empty session handle/,
    );
  });
});

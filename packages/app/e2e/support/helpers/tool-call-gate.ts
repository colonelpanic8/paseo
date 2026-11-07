import type { Page } from "@playwright/test";
import { daemonWsRoutePattern } from "./daemon-port";

type WebSocketMessage = string | Buffer;

function parseSessionMessage(message: WebSocketMessage): Record<string, unknown> | null {
  const raw = typeof message === "string" ? message : message.toString("utf8");
  try {
    const envelope = JSON.parse(raw) as { type?: unknown; message?: unknown };
    return envelope.type === "session" && envelope.message && typeof envelope.message === "object"
      ? (envelope.message as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function getToolCallStatus(
  message: WebSocketMessage,
  agentId: string,
): { callId: string; status: string } | null {
  const sessionMessage = parseSessionMessage(message);
  if (sessionMessage?.type !== "agent_stream") {
    return null;
  }
  const payload = sessionMessage.payload as Record<string, unknown> | undefined;
  if (payload?.agentId !== agentId) {
    return null;
  }
  const event = payload.event as Record<string, unknown> | undefined;
  const item = event?.item as Record<string, unknown> | undefined;
  return event?.type === "timeline" &&
    item?.type === "tool_call" &&
    typeof item.callId === "string" &&
    typeof item.status === "string"
    ? { callId: item.callId, status: item.status }
    : null;
}

function replaceToolCallStatus(message: WebSocketMessage, status: string): string {
  const raw = typeof message === "string" ? message : message.toString("utf8");
  const envelope = JSON.parse(raw) as {
    message?: { payload?: { event?: { item?: { status?: string } } } };
  };
  const item = envelope.message?.payload?.event?.item;
  if (!item) {
    throw new Error("Expected a tool-call session message");
  }
  item.status = status;
  return JSON.stringify(envelope);
}

export async function gateSecondToolCall(page: Page, agentId: string) {
  const heldFirstRunningMessages: WebSocketMessage[] = [];
  let firstCallId: string | null = null;
  let secondCallId: string | null = null;
  let secondRunningMessage: WebSocketMessage | null = null;
  let releaseSecondRequested = false;
  let pauseServerMessages = false;
  let secondRunningForwarded = false;
  let forwardSecondRunning: (() => void) | null = null;
  let resolveFirstCompleted!: () => void;
  let resolveSecondRunning!: () => void;
  const firstCompleted = new Promise<void>((resolve) => {
    resolveFirstCompleted = resolve;
  });
  const secondRunning = new Promise<void>((resolve) => {
    resolveSecondRunning = resolve;
  });

  await page.routeWebSocket(daemonWsRoutePattern(), (ws) => {
    const server = ws.connectToServer();
    forwardSecondRunning = () => {
      if (!secondRunningMessage || secondRunningForwarded) {
        return;
      }
      ws.send(secondRunningMessage);
      secondRunningForwarded = true;
    };
    ws.onMessage((message) => server.send(message));
    server.onMessage((message) => {
      if (pauseServerMessages) {
        return;
      }

      const toolCall = getToolCallStatus(message, agentId);
      if (!toolCall) {
        ws.send(message);
        return;
      }

      if (!firstCallId) {
        firstCallId = toolCall.callId;
      }
      if (toolCall.callId === firstCallId) {
        // Held rather than dropped. The app applies agent_stream events only in
        // unbroken seq order: skip one and it discards everything after it and
        // waits on a catch-up that this route has usually already paused, so
        // the group never mounts at all. Releasing the held frames immediately
        // ahead of the terminal one keeps the sequence intact and still lands
        // the group on screen already idle — which the daemon's coalescing
        // window only does on its own when the machine is fast enough.
        if (toolCall.status === "running" || toolCall.status === "executing") {
          heldFirstRunningMessages.push(message);
          return;
        }
        for (const held of heldFirstRunningMessages) {
          ws.send(held);
        }
        heldFirstRunningMessages.length = 0;
        ws.send(message);
        if (toolCall.status === "completed") {
          resolveFirstCompleted();
        }
        return;
      }

      secondCallId ??= toolCall.callId;
      if (
        toolCall.callId === secondCallId &&
        (toolCall.status === "running" || toolCall.status === "executing")
      ) {
        secondRunningMessage = message;
        pauseServerMessages = true;
        resolveSecondRunning();
        if (releaseSecondRequested) {
          forwardSecondRunning?.();
        }
        return;
      }

      if (toolCall.callId === secondCallId && toolCall.status === "completed") {
        // Keep the second real tool call inspectably active. Production providers
        // send this same status shape while their work remains in flight.
        secondRunningMessage = replaceToolCallStatus(message, "running");
        pauseServerMessages = true;
        resolveSecondRunning();
        if (releaseSecondRequested) {
          forwardSecondRunning?.();
        }
        return;
      }

      ws.send(message);
    });
  });

  return {
    waitForFirstCompleted: () => firstCompleted,
    waitForSecondRunning: () => secondRunning,
    releaseSecondRunning() {
      releaseSecondRequested = true;
      if (secondRunningMessage) {
        forwardSecondRunning?.();
      }
    },
  };
}

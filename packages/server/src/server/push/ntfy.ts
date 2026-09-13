import { buildAgentDeepLink } from "@getpaseo/protocol/agent-deep-link";
import type pino from "pino";

import type { PushPayload } from "./push-service.js";

export interface NtfyTarget {
  serverUrl: string;
  topic: string;
}

export interface NtfyPublishRequest {
  url: string;
  init: RequestInit;
}

export type NtfyFetch = (
  url: string,
  init: RequestInit,
) => Promise<Pick<Response, "ok" | "status" | "statusText">>;

function readString(data: PushPayload["data"], key: string): string | null {
  const value = data?.[key];
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

// Mirrors the app's notification routing: agents open directly, everything
// else lands on the host. Terminal targets need the app's workspace path
// encoding, which the daemon does not have.
export function resolveNotificationDeepLink(data: PushPayload["data"]): string | null {
  const serverId = readString(data, "serverId");
  if (!serverId) return null;
  const agentId = readString(data, "agentId");
  if (agentId) return buildAgentDeepLink({ serverId, agentId });
  return `paseo://h/${encodeURIComponent(serverId)}`;
}

// ntfy's JSON publish endpoint is the server root; the topic travels in the body.
export function buildNtfyPublishRequest(
  target: NtfyTarget,
  payload: PushPayload,
): NtfyPublishRequest {
  const body: Record<string, string> = {
    topic: target.topic,
    title: payload.title,
    message: payload.body,
  };
  const click = resolveNotificationDeepLink(payload.data);
  if (click) body.click = click;

  return {
    url: `${target.serverUrl.replace(/\/+$/, "")}/`,
    init: {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  };
}

export async function publishToNtfy(input: {
  target: NtfyTarget;
  payload: PushPayload;
  logger: pino.Logger;
  fetch?: NtfyFetch;
}): Promise<void> {
  const { url, init } = buildNtfyPublishRequest(input.target, input.payload);
  const fetchImpl = input.fetch ?? globalThis.fetch;
  try {
    const response = await fetchImpl(url, init);
    if (!response.ok) {
      input.logger.error(
        { status: response.status, statusText: response.statusText, url },
        "ntfy publish failed",
      );
    }
  } catch (error) {
    input.logger.error({ err: error, url }, "Failed to publish to ntfy");
  }
}

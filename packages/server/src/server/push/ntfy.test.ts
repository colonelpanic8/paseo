import type pino from "pino";
import { describe, expect, test } from "vitest";

import { buildNtfyPublishRequest, publishToNtfy, resolveNotificationDeepLink } from "./ntfy.js";

function createLogger(): { logger: pino.Logger; errors: unknown[] } {
  const errors: unknown[] = [];
  const logger = {
    child: () => logger,
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: (details: unknown) => errors.push(details),
  };
  return { logger: logger as unknown as pino.Logger, errors };
}

describe("ntfy push delivery", () => {
  test("publishes JSON to the server root with the topic and agent deep link", () => {
    const request = buildNtfyPublishRequest(
      { serverUrl: "http://jimi-hendnix:2586/", topic: "paseo-abc" },
      {
        title: "Agent finished",
        body: "Done",
        data: { serverId: "srv 1", workspaceId: "ws", agentId: "agent/1", reason: "finished" },
      },
    );

    expect(request.url).toBe("http://jimi-hendnix:2586/");
    expect(request.init.method).toBe("POST");
    expect(request.init.headers).toEqual({ "Content-Type": "application/json" });
    expect(JSON.parse(request.init.body as string)).toEqual({
      topic: "paseo-abc",
      title: "Agent finished",
      message: "Done",
      click: "paseo://h/srv%201/agent/agent%2F1",
    });
  });

  test("terminal notifications link to the host", () => {
    const request = buildNtfyPublishRequest(
      { serverUrl: "http://ntfy.local", topic: "t" },
      {
        title: "Terminal finished",
        body: "build",
        data: { serverId: "srv", terminalId: "term-1", cwd: "/tmp" },
      },
    );

    expect(JSON.parse(request.init.body as string).click).toBe("paseo://h/srv");
    expect(resolveNotificationDeepLink(undefined)).toBeNull();
    expect(resolveNotificationDeepLink({ agentId: "a" })).toBeNull();
  });

  test("a rejected publish is logged, not thrown", async () => {
    const { logger, errors } = createLogger();

    await publishToNtfy({
      target: { serverUrl: "http://ntfy.local", topic: "t" },
      payload: { title: "x", body: "y" },
      logger,
      fetch: async () => ({ ok: false, status: 403, statusText: "Forbidden" }),
    });
    await publishToNtfy({
      target: { serverUrl: "http://ntfy.local", topic: "t" },
      payload: { title: "x", body: "y" },
      logger,
      fetch: async () => {
        throw new Error("ECONNREFUSED");
      },
    });

    expect(errors).toHaveLength(2);
    expect(errors[0]).toMatchObject({ status: 403 });
  });
});

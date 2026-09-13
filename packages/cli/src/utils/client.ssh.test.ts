import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolveSshFailureDetail } from "../ssh/ssh-tunnel.js";
import { parseHostTarget } from "@getpaseo/client/node";
import { connectToDaemon } from "./client.js";

const mocks = vi.hoisted(() => ({
  getOrCreateCliClientId: vi.fn(async () => "cli-test-id"),
}));

vi.mock("@getpaseo/client/node", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@getpaseo/client/node")>()),
  createHostClient: () => ({
    lastError: null,
    async connect() {},
    async close() {},
  }),
}));
vi.mock("./client-id.js", () => ({ getOrCreateCliClientId: mocks.getOrCreateCliClientId }));

describe("CLI SSH transport", () => {
  beforeEach(() => {
    mocks.getOrCreateCliClientId.mockClear();
  });

  it("surfaces SSH stderr before the child exit event settles", () => {
    expect(resolveSshFailureDetail(null, "Host key verification failed.\n")).toBe(
      "Host key verification failed.",
    );
    expect(resolveSshFailureDetail("ssh exited with code 255", "earlier stderr")).toBe(
      "ssh exited with code 255",
    );
  });
  it("uses the shared SSH target grammar and excludes reusable credentials from discovery", () => {
    expect(parseHostTarget("ssh://deploy@build-box:2222?daemonPort=7777")).toEqual({
      kind: "ssh",
      ssh: { host: "deploy@build-box", sshPort: 2222, daemonPort: 7777 },
      description: "ssh://build-box:2222 (daemon port 7777)",
    });
    expect(() => parseHostTarget("ssh://deploy:secret@build-box")).toThrow(
      "Invalid host connection",
    );
  });

  it.runIf(process.platform === "linux")(
    "stores the CLI identity under custom XDG data while ignoring PASEO_HOME",
    async () => {
      const root = mkdtempSync(path.join(tmpdir(), "paseo-cli-identity-"));
      const dataHome = path.join(root, "data", "paseo");
      mkdirSync(dataHome, { recursive: true });
      writeFileSync(path.join(dataHome, ".xdg-layout"), "1\n");
      const previous = {
        PASEO_HOME: process.env.PASEO_HOME,
        XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME,
        XDG_DATA_HOME: process.env.XDG_DATA_HOME,
      };
      process.env.PASEO_HOME = "/tmp/daemon-instance";
      process.env.XDG_CONFIG_HOME = path.join(root, "config");
      process.env.XDG_DATA_HOME = path.join(root, "data");
      try {
        await connectToDaemon({ target: { kind: "endpoint", host: "localhost:6767" } });
      } finally {
        for (const [key, value] of Object.entries(previous)) {
          if (value === undefined) delete process.env[key];
          else process.env[key] = value;
        }
        rmSync(root, { recursive: true, force: true });
      }

      expect(mocks.getOrCreateCliClientId).toHaveBeenCalledWith(dataHome);
    },
  );
});

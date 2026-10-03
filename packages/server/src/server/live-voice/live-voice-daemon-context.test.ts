import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import pino from "pino";
import {
  LIVE_VOICE_CONTEXT_FILE_MAX_BYTES,
  LiveVoiceDaemonContextProvider,
} from "./live-voice-daemon-context.js";

const logger = pino({ level: "silent" });

function createProvider(paseoHome: string): LiveVoiceDaemonContextProvider {
  return new LiveVoiceDaemonContextProvider({
    agents: { listAgents: () => [], hasPaseoMcpInjection: () => true },
    workspaces: { list: async () => [] },
    logger,
    paseoHome,
  });
}

describe("LiveVoiceDaemonContextProvider profile files", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "paseo-voice-context-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("appends readable files as developer items, skips unreadable ones, and announces them", async () => {
    await writeFile(join(dir, "profile.org"), "* Standing context\nPrefer terse replies.\n");
    const context = await createProvider(dir).build({
      crossHostRoutingAvailable: true,
      contextFiles: [join(dir, "profile.org"), join(dir, "missing.org")],
    });
    expect(context).not.toBeNull();
    const fileItems = context!.initialItems.filter((item) =>
      item.text.startsWith("User context file: "),
    );
    expect(fileItems).toHaveLength(1);
    expect(fileItems[0]).toMatchObject({ role: "developer" });
    expect(fileItems[0]?.text).toContain("Prefer terse replies.");
    expect(context!.prompt).toContain("Standing context from the user");
  });

  it("truncates an oversized file on a line boundary and says so", async () => {
    const line = "x".repeat(200);
    await writeFile(
      join(dir, "big.md"),
      Array.from({ length: 200 }, (_, index) => `${index} ${line}`).join("\n"),
    );
    const context = await createProvider(dir).build({
      crossHostRoutingAvailable: true,
      limits: { contextTokenBudget: 100_000, bytesPerToken: 4 },
      contextFiles: [join(dir, "big.md")],
    });
    const item = context!.initialItems.find((entry) => entry.text.startsWith("User context file"));
    expect(item).toBeDefined();
    expect(Buffer.byteLength(item!.text)).toBeLessThanOrEqual(
      LIVE_VOICE_CONTEXT_FILE_MAX_BYTES + 128,
    );
    expect(item!.text.endsWith("[Truncated for Live Voice context limits.]")).toBe(true);
  });

  it("leaves the prompt alone without files", async () => {
    const context = await createProvider(dir).build({ crossHostRoutingAvailable: true });
    expect(context!.prompt).not.toContain("Standing context from the user");
  });
});

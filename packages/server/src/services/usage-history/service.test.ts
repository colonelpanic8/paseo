import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { decodeScanCache } from "./scan-cache.js";
import { createTestLogger } from "../../test-utils/test-logger.js";
import {
  LITELLM_RATES_URL,
  UsageHistoryInvalidWindowError,
  UsageHistoryService,
  UsageHistoryBusyError,
  type UsageHistoryServiceOptions,
} from "./service.js";

let home: string;
let paseoHome: string;
let claudeConfigDir: string;
let codexHome: string;
let transcript: string;

const WINDOW = {
  timeZone: "UTC",
  sinceDay: "2026-07-31",
  untilDay: "2026-08-02",
};
const RATES_DOCUMENT = {
  "claude-fable-5": {
    input_cost_per_token: 1e-5,
    output_cost_per_token: 5e-5,
  },
};

beforeEach(async () => {
  home = await fs.mkdtemp(path.join(os.tmpdir(), "usage-service-test-"));
  paseoHome = path.join(home, "paseo");
  claudeConfigDir = path.join(home, "claude");
  codexHome = path.join(home, "codex");
  const transcriptDir = path.join(claudeConfigDir, "projects", "proj");
  await fs.mkdir(transcriptDir, { recursive: true });
  transcript = path.join(transcriptDir, "session.jsonl");
});

afterEach(async () => {
  await fs.rm(home, { recursive: true, force: true });
});

function claudeLine(id: number, outputTokens: number, model = "claude-fable-5"): string {
  return `${JSON.stringify({
    type: "assistant",
    timestamp: "2026-08-01T10:00:00Z",
    requestId: `req_${id}`,
    sessionId: "session-1",
    message: {
      id: `msg_${id}`,
      model,
      usage: { input_tokens: 10, output_tokens: outputTokens },
    },
  })}\n`;
}

function makeService(options: Partial<UsageHistoryServiceOptions> = {}) {
  return new UsageHistoryService({
    paseoHome,
    claudeConfigDir,
    codexHome,
    logger: createTestLogger(),
    fetch: options.fetch ?? (async () => Response.json(RATES_DOCUMENT)),
    now: options.now,
    getProviderConfigs: options.getProviderConfigs,
  });
}

function totalOutputTokens(summary: { buckets: readonly { totals: { outputTokens: number } }[] }) {
  return summary.buckets.reduce((sum, bucket) => sum + bucket.totals.outputTokens, 0);
}

describe("UsageHistoryService", () => {
  it("counts appended usage by resuming a grown transcript", async () => {
    await fs.writeFile(transcript, claudeLine(1, 5));
    const service = makeService();
    expect(totalOutputTokens(await service.readSummary(WINDOW))).toBe(5);

    await fs.appendFile(transcript, claudeLine(2, 7));
    expect(totalOutputTokens(await service.readSummary(WINDOW))).toBe(12);
  });

  it("shares one scan between concurrent identical requests", async () => {
    await fs.writeFile(transcript, claudeLine(1, 5));
    let fetches = 0;
    let releaseFetch = () => {};
    const blocked = new Promise<void>((resolve) => {
      releaseFetch = resolve;
    });
    const service = makeService({
      fetch: async () => {
        fetches += 1;
        await blocked;
        return Response.json(RATES_DOCUMENT);
      },
    });

    const first = service.readSummary(WINDOW);
    const second = service.readSummary(WINDOW);
    releaseFetch();
    expect(await first).toEqual(await second);
    expect(fetches).toBe(1);
  });

  it("bounds distinct requests, serializes scans, and persists the final cache", async () => {
    await fs.writeFile(transcript, claudeLine(1, 5));
    let releaseFetch = () => {};
    const blocked = new Promise<void>((resolve) => {
      releaseFetch = resolve;
    });
    let fetchStarted = () => {};
    const started = new Promise<void>((resolve) => {
      fetchStarted = resolve;
    });
    let configReads = 0;
    const service = makeService({
      getProviderConfigs: () => {
        configReads += 1;
        return {};
      },
      fetch: async () => {
        fetchStarted();
        await blocked;
        return Response.json(RATES_DOCUMENT);
      },
    });
    const first = service.readSummary(WINDOW);
    expect(service.readSummary(WINDOW)).toBe(first);
    const pending = Array.from({ length: 7 }, (_, i) =>
      service.readSummary({
        ...WINDOW,
        untilDay: `2026-08-${String(i + 3).padStart(2, "0")}`,
      }),
    );
    expect(() => service.readSummary({ ...WINDOW, untilDay: "2026-08-10" })).toThrow(
      UsageHistoryBusyError,
    );
    await started;
    expect(configReads).toBe(1);
    await fs.appendFile(transcript, claudeLine(2, 7));
    releaseFetch();
    await first;
    const summaries = await Promise.all(pending);
    expect(configReads).toBe(8);
    const diskCache = decodeScanCache(
      JSON.parse(
        await fs.readFile(path.join(paseoHome, "usage-history", "scan-cache.json"), "utf8"),
      ),
    );
    expect(diskCache.get(transcript)?.records).toHaveLength(2);
    expect(summaries.every((summary) => totalOutputTokens(summary) === 12)).toBe(true);
    expect(totalOutputTokens(await makeService().readSummary(WINDOW))).toBe(12);
    expect(totalOutputTokens(await service.readSummary(WINDOW))).toBe(12);
  });

  it("reads configured accounts, deduplicates shared roots, and follows config changes", async () => {
    await fs.writeFile(transcript, claudeLine(1, 5));
    const extraHome = path.join(home, "claude-work");
    const extraDir = path.join(extraHome, "projects");
    await fs.mkdir(extraDir, { recursive: true });
    await fs.writeFile(path.join(extraDir, "work.jsonl"), claudeLine(2, 7));
    const alias = path.join(home, "alias");
    await fs.symlink(extraHome, alias, "junction");
    let providers: ReturnType<NonNullable<UsageHistoryServiceOptions["getProviderConfigs"]>> = {};
    const service = makeService({ getProviderConfigs: () => providers });
    expect(totalOutputTokens(await service.readSummary(WINDOW))).toBe(5);
    providers = {
      work: { extends: "claude", env: { CLAUDE_CONFIG_DIR: extraHome } },
      alias: { extends: "claude", env: { CLAUDE_CONFIG_DIR: alias } },
      shared: { extends: "claude" },
      disabled: { extends: "claude", enabled: false, env: { CLAUDE_CONFIG_DIR: extraHome } },
    };
    const summary = await service.readSummary(WINDOW);
    expect(totalOutputTokens(summary)).toBe(12);
    expect(summary.sources.filter((source) => source.provider === "claude")).toHaveLength(2);
    expect(summary.buckets.map((bucket) => bucket.provider)).toEqual(["claude"]);
    providers = {};
    expect(totalOutputTokens(await service.readSummary(WINDOW))).toBe(5);
  });

  it("counts two Codex accounts once when an account has multiple configured aliases", async () => {
    const workHome = path.join(home, "codex-work");
    for (const [root, id, output] of [
      [codexHome, "personal", 5],
      [workHome, "work", 7],
    ] as const) {
      const dir = path.join(root, "sessions");
      await fs.mkdir(dir, { recursive: true });
      const rows = [
        { type: "session_meta", payload: { id } },
        { type: "turn_context", payload: { model: "gpt-5" } },
        {
          type: "event_msg",
          timestamp: "2026-08-01T10:00:00Z",
          payload: {
            type: "token_count",
            info: { last_token_usage: { input_tokens: 10, output_tokens: output } },
          },
        },
      ];
      await fs.writeFile(
        path.join(dir, "session.jsonl"),
        rows.map((row) => JSON.stringify(row)).join("\n") + "\n",
      );
    }
    const summary = await makeService({
      getProviderConfigs: () => ({
        work: { extends: "codex", env: { CODEX_HOME: workHome } },
        alias: { extends: "codex", env: { CODEX_HOME: workHome } },
        personal: { extends: "codex", env: { CODEX_HOME: codexHome } },
      }),
    }).readSummary(WINDOW);
    expect(totalOutputTokens(summary)).toBe(12);
    expect(summary.sources.filter((source) => source.provider === "codex")).toHaveLength(2);
    expect(summary.sources.reduce((sum, source) => sum + source.distinctSessions, 0)).toBe(2);
  });

  it("releases admission after a scan fails", async () => {
    let fail = true;
    const service = makeService({
      getProviderConfigs: () => {
        if (fail) throw new Error("configuration unavailable");
        return {};
      },
    });
    await expect(service.readSummary(WINDOW)).rejects.toThrow("configuration unavailable");
    fail = false;
    await fs.writeFile(transcript, claudeLine(1, 5));
    expect(totalOutputTokens(await service.readSummary(WINDOW))).toBe(5);
  });

  it("forces rate refresh inside the TTL, subject to the 60-second floor", async () => {
    await fs.writeFile(transcript, claudeLine(1, 5));
    let nowMs = Date.parse("2026-08-01T12:00:00Z");
    let fetches = 0;
    const service = makeService({
      now: () => nowMs,
      fetch: async () => {
        fetches += 1;
        return Response.json(RATES_DOCUMENT);
      },
    });

    expect((await service.readSummary(WINDOW)).pricing.status).toBe("fresh");
    expect(fetches).toBe(1);
    await service.refreshRates();
    expect(fetches).toBe(1);
    nowMs += 61_000;
    const refreshed = await service.refreshRates();
    expect(fetches).toBe(2);
    expect(refreshed.status).toBe("fresh");
  });

  it("loads the durable scan cache in a new service instance", async () => {
    await fs.writeFile(transcript, claudeLine(1, 5));
    await makeService().readSummary(WINDOW);
    const cachePath = path.join(paseoHome, "usage-history", "scan-cache.json");
    expect((await fs.stat(cachePath)).size).toBeGreaterThan(0);

    const restarted = makeService();
    expect(totalOutputTokens(await restarted.readSummary(WINDOW))).toBe(5);
  });

  it("falls back to an on-disk rate snapshot when refresh fails", async () => {
    const rateDir = path.join(paseoHome, "usage-history");
    await fs.mkdir(rateDir, { recursive: true });
    const fetchedAtMs = Date.parse("2026-07-01T00:00:00Z");
    await fs.writeFile(
      path.join(rateDir, "model-rates.json"),
      JSON.stringify({ fetchedAtMs, document: RATES_DOCUMENT }),
    );
    await fs.writeFile(transcript, claudeLine(1, 5));

    const service = makeService({
      now: () => Date.parse("2026-08-01T00:00:00Z"),
      fetch: async () => {
        throw new Error("offline");
      },
    });
    const summary = await service.readSummary(WINDOW);
    expect(summary.pricing).toEqual({
      status: "cached",
      source: LITELLM_RATES_URL,
      fetchedAt: new Date(fetchedAtMs).toISOString(),
      knownModels: 1,
    });
    expect(summary.buckets[0]?.costSource).toBe("modelPriced");
  });

  it("reports missing provider directories without failing the read", async () => {
    await fs.writeFile(transcript, claudeLine(1, 5));
    const summary = await makeService().readSummary(WINDOW);
    expect(summary.sources).toEqual([
      {
        provider: "claude",
        path: path.join(claudeConfigDir, "projects"),
        status: "ok",
        scannedFiles: 1,
        skippedFiles: 0,
        distinctSessions: 1,
        message: null,
      },
      {
        provider: "codex",
        path: path.join(codexHome, "sessions"),
        status: "missing",
        scannedFiles: 0,
        skippedFiles: 0,
        distinctSessions: 0,
        message: "No transcript directory on this environment.",
      },
    ]);
  });

  it("rejects malformed, impossible, and reversed windows before scanning", async () => {
    const service = makeService({
      fetch: async () => {
        throw new Error("must not fetch");
      },
    });
    for (const window of [
      { ...WINDOW, sinceDay: "2026-8-01" },
      { ...WINDOW, sinceDay: "2026-02-30" },
      { ...WINDOW, sinceDay: "2026-08-03" },
      { ...WINDOW, sinceDay: "2026-01-01" },
      { ...WINDOW, timeZone: "Not/AZone" },
    ]) {
      expect(() => service.readSummary(window)).toThrow(UsageHistoryInvalidWindowError);
    }
  });
});

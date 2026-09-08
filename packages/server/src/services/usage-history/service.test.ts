import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestLogger } from "../../test-utils/test-logger.js";
import {
  LITELLM_RATES_URL,
  UsageHistoryInvalidWindowError,
  UsageHistoryService,
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

function makeService(
  options: {
    fetch?: typeof fetch;
    now?: () => number;
    overrides?: Record<string, unknown>;
  } = {},
) {
  return new UsageHistoryService({
    paseoHome,
    claudeConfigDir,
    codexHome,
    logger: createTestLogger(),
    readProviderOverrides: () => options.overrides,
    fetch: options.fetch ?? (async () => Response.json(RATES_DOCUMENT)),
    now: options.now,
  });
}

/** Codex needs a turn context before a token event, and its session id comes from the meta line. */
async function writeCodexTranscript(
  providerHome: string,
  session: string,
  outputTokens: number,
): Promise<void> {
  const dir = path.join(providerHome, "sessions", "2026", "08", "01");
  await fs.mkdir(dir, { recursive: true });
  const lines = [
    { type: "session_meta", timestamp: "2026-08-01T10:00:00Z", payload: { id: session } },
    {
      type: "turn_context",
      timestamp: "2026-08-01T10:00:01Z",
      payload: { model: "gpt-5-codex" },
    },
    {
      type: "event_msg",
      timestamp: "2026-08-01T10:00:02Z",
      payload: {
        type: "token_count",
        info: { last_token_usage: { input_tokens: 20, output_tokens: outputTokens } },
      },
    },
  ];
  await fs.writeFile(
    path.join(dir, `${session}.jsonl`),
    lines.map((line) => `${JSON.stringify(line)}\n`).join(""),
  );
}

function outputTokensByProviderId(summary: {
  buckets: readonly { providerId?: string; totals: { outputTokens: number } }[];
}): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const bucket of summary.buckets) {
    const key = bucket.providerId ?? "";
    totals[key] = (totals[key] ?? 0) + bucket.totals.outputTokens;
  }
  return totals;
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
        providerId: "claude",
        label: "Claude",
        path: path.join(claudeConfigDir, "projects"),
        status: "ok",
        scannedFiles: 1,
        skippedFiles: 0,
        distinctSessions: 1,
        message: null,
      },
      {
        provider: "codex",
        providerId: "codex",
        label: "Codex",
        path: path.join(codexHome, "sessions"),
        status: "missing",
        scannedFiles: 0,
        skippedFiles: 0,
        distinctSessions: 0,
        message: "No transcript directory on this environment.",
      },
    ]);
  });

  it("counts every configured home and attributes its buckets to the owning provider", async () => {
    await fs.writeFile(transcript, claudeLine(1, 5));
    const benHome = path.join(home, "codex-ben");
    const colonelHome = path.join(home, "codex-colonel");
    await writeCodexTranscript(benHome, "session-ben", 11);
    await writeCodexTranscript(colonelHome, "session-colonel", 23);

    const summary = await makeService({
      overrides: {
        "codex-ben": {
          extends: "codex",
          label: "Codex (Ben)",
          env: { CODEX_HOME: benHome },
        },
        "codex-colonel": {
          extends: "codex",
          label: "Codex (Colonel)",
          env: { CODEX_HOME: colonelHome },
        },
      },
    }).readSummary(WINDOW);

    expect(outputTokensByProviderId(summary)).toEqual({
      claude: 5,
      "codex-ben": 11,
      "codex-colonel": 23,
    });
    expect(summary.buckets.every((bucket) => bucket.provider !== "codex-ben")).toBe(true);
    expect(
      summary.sources.map((source) => ({
        provider: source.provider,
        providerId: source.providerId,
        label: source.label,
        status: source.status,
        scannedFiles: source.scannedFiles,
        distinctSessions: source.distinctSessions,
      })),
    ).toEqual([
      {
        provider: "claude",
        providerId: "claude",
        label: "Claude",
        status: "ok",
        scannedFiles: 1,
        distinctSessions: 1,
      },
      {
        provider: "codex",
        providerId: "codex",
        label: "Codex",
        status: "missing",
        scannedFiles: 0,
        distinctSessions: 0,
      },
      {
        provider: "codex",
        providerId: "codex-ben",
        label: "Codex (Ben)",
        status: "ok",
        scannedFiles: 1,
        distinctSessions: 1,
      },
      {
        provider: "codex",
        providerId: "codex-colonel",
        label: "Codex (Colonel)",
        status: "ok",
        scannedFiles: 1,
        distinctSessions: 1,
      },
    ]);
  });

  it("scans a home shared by two configured providers once", async () => {
    const sharedHome = path.join(home, "codex-shared");
    await writeCodexTranscript(sharedHome, "session-shared", 17);
    const shared = { extends: "codex", env: { CODEX_HOME: sharedHome } };

    const summary = await makeService({
      overrides: { "codex-one": shared, "codex-two": { ...shared, label: "Two" } },
    }).readSummary(WINDOW);

    expect(outputTokensByProviderId(summary)).toEqual({ "codex-one": 17 });
    expect(summary.sources.filter((source) => source.path.startsWith(sharedHome))).toHaveLength(1);
  });

  it("reports a configured home that does not exist without suppressing the others", async () => {
    const realHome = path.join(home, "codex-real");
    await writeCodexTranscript(realHome, "session-real", 9);

    const summary = await makeService({
      overrides: {
        "codex-gone": {
          extends: "codex",
          label: "Gone",
          env: { CODEX_HOME: path.join(home, "codex-gone") },
        },
        "codex-real": { extends: "codex", label: "Real", env: { CODEX_HOME: realHome } },
      },
    }).readSummary(WINDOW);

    expect(summary.sources.find((source) => source.providerId === "codex-gone")).toMatchObject({
      status: "missing",
      scannedFiles: 0,
    });
    expect(outputTokensByProviderId(summary)).toEqual({ "codex-real": 9 });
  });

  it("ignores providers that do not extend a transcript-keeping provider", async () => {
    const copilotHome = path.join(home, "copilot");
    await writeCodexTranscript(copilotHome, "session-copilot", 13);

    const summary = await makeService({
      overrides: {
        "copilot-work": {
          extends: "copilot",
          label: "Copilot (Work)",
          env: { CODEX_HOME: copilotHome },
        },
      },
    }).readSummary(WINDOW);

    expect(summary.sources.map((source) => source.providerId)).toEqual(["claude", "codex"]);
    expect(outputTokensByProviderId(summary)).toEqual({});
  });

  it("resolves an extends chain transitively and does not hang on a cycle", async () => {
    const chainHome = path.join(home, "codex-chain");
    await writeCodexTranscript(chainHome, "session-chain", 3);

    const summary = await makeService({
      overrides: {
        "codex-base": { extends: "codex", label: "Base" },
        "codex-leaf": {
          extends: "codex-base",
          label: "Leaf",
          env: { CODEX_HOME: chainHome },
        },
        "loop-a": { extends: "loop-b", label: "A" },
        "loop-b": { extends: "loop-a", label: "B" },
      },
    }).readSummary(WINDOW);

    expect(summary.sources.map((source) => source.providerId)).toEqual([
      "claude",
      "codex",
      "codex-leaf",
    ]);
    expect(outputTokensByProviderId(summary)).toEqual({ "codex-leaf": 3 });
  });

  it("totals the same as scanning each home on its own", async () => {
    await fs.writeFile(transcript, claudeLine(1, 5));
    const benHome = path.join(home, "codex-ben");
    const colonelHome = path.join(home, "codex-colonel");
    await writeCodexTranscript(benHome, "session-ben", 11);
    await writeCodexTranscript(colonelHome, "session-colonel", 23);
    const ben = { extends: "codex", label: "Ben", env: { CODEX_HOME: benHome } };
    const colonel = { extends: "codex", label: "Colonel", env: { CODEX_HOME: colonelHome } };

    const combined = await makeService({
      overrides: { "codex-ben": ben, "codex-colonel": colonel },
    }).readSummary(WINDOW);
    const separate = [
      await makeService().readSummary(WINDOW),
      await makeService({ overrides: { "codex-ben": ben } }).readSummary(WINDOW),
      await makeService({ overrides: { "codex-colonel": colonel } }).readSummary(WINDOW),
    ];

    expect(totalOutputTokens(combined)).toBe(
      separate.reduce((sum, summary) => sum + totalOutputTokens(summary), 0) -
        // The default claude home is scanned by every one of the three separate reads.
        2 * totalOutputTokens(separate[0] ?? { buckets: [] }),
    );
    expect(totalOutputTokens(combined)).toBe(5 + 11 + 23);
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
    ]) {
      expect(() => service.readSummary(window)).toThrow(UsageHistoryInvalidWindowError);
    }
  });
});

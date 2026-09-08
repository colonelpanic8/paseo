import { describe, expect, it } from "vitest";
import { buildChartColumns, niceScale } from "./chart-data";
import { configuredProvidersByKind, deriveProviderUsageHistory } from "./derive";
import type { ProviderUsageHistoryHostPayload } from "./derive";
import type {
  ProviderUsageHistoryBucket,
  ProviderUsageHistoryPayload,
  ProviderUsageHistorySource,
} from "./types";

interface BucketOverrides {
  day: string;
  provider: string;
  providerId?: string;
  model: string;
  uncachedInputTokens?: number;
  cachedInputTokens?: number;
  cacheCreationTokens?: number;
  outputTokens?: number;
  reasoningTokens?: number;
  costUsd?: number;
  cacheSavingsUsd?: number;
  records?: number;
  unpricedRecords?: number;
  sessions?: number;
  costSource?: ProviderUsageHistoryBucket["costSource"];
}

function bucket(overrides: BucketOverrides): ProviderUsageHistoryBucket {
  return {
    day: overrides.day,
    provider: overrides.provider,
    ...(overrides.providerId === undefined ? {} : { providerId: overrides.providerId }),
    model: overrides.model,
    totals: {
      uncachedInputTokens: overrides.uncachedInputTokens ?? 0,
      cachedInputTokens: overrides.cachedInputTokens ?? 0,
      cacheCreationTokens: overrides.cacheCreationTokens ?? 0,
      outputTokens: overrides.outputTokens ?? 0,
      reasoningTokens: overrides.reasoningTokens ?? 0,
    },
    costUsd: overrides.costUsd ?? 0,
    cacheSavingsUsd: overrides.cacheSavingsUsd ?? 0,
    costSource: overrides.costSource ?? "modelPriced",
    records: overrides.records ?? 1,
    unpricedRecords: overrides.unpricedRecords ?? 0,
    sessions: overrides.sessions ?? 1,
  };
}

function source(
  provider: string,
  distinctSessions: number,
  status: ProviderUsageHistorySource["status"] = "ok",
): ProviderUsageHistorySource {
  return {
    provider,
    path: `/home/dev/.${provider}`,
    status,
    scannedFiles: 3,
    skippedFiles: 0,
    distinctSessions,
    message: null,
  };
}

/** A source from a daemon that scans one home per configured provider. */
function configuredSource(
  provider: string,
  providerId: string,
  label: string,
  distinctSessions: number,
  status: ProviderUsageHistorySource["status"] = "ok",
): ProviderUsageHistorySource {
  return {
    ...source(provider, distinctSessions, status),
    providerId,
    label,
    path: `/home/dev/.${providerId}`,
  };
}

function payload(
  buckets: ProviderUsageHistoryBucket[],
  sources: ProviderUsageHistorySource[],
): ProviderUsageHistoryPayload {
  return {
    requestId: "req-1",
    readAt: "2026-09-07T12:00:00.000Z",
    timeZone: "America/New_York",
    sinceDay: "2026-09-05",
    untilDay: "2026-09-07",
    buckets,
    sources,
    pricing: {
      status: "cached",
      source: "litellm",
      fetchedAt: "2026-09-07T11:00:00.000Z",
      knownModels: 400,
    },
    scanDurationMs: 120,
  };
}

/** The single-host case: one payload, every source counted. */
function onlyHost(input: ProviderUsageHistoryPayload): ProviderUsageHistoryHostPayload[] {
  return [
    { serverId: "host-a", hostName: "ryzen-shine", payload: input, countedSources: input.sources },
  ];
}

const SAMPLE = payload(
  [
    bucket({
      day: "2026-09-05",
      provider: "claude",
      model: "sonnet-5",
      uncachedInputTokens: 1_000,
      cachedInputTokens: 4_000,
      cacheCreationTokens: 500,
      outputTokens: 2_000,
      reasoningTokens: 800,
      costUsd: 3,
      cacheSavingsUsd: 1,
      records: 4,
    }),
    bucket({
      day: "2026-09-07",
      provider: "claude",
      model: "sonnet-5",
      uncachedInputTokens: 500,
      outputTokens: 500,
      costUsd: 1,
      records: 2,
    }),
    bucket({
      day: "2026-09-07",
      provider: "codex",
      model: "gpt-5",
      uncachedInputTokens: 2_000,
      outputTokens: 1_000,
      costUsd: 2,
      records: 3,
    }),
  ],
  [source("claude", 5), source("codex", 3)],
);

describe("deriveProviderUsageHistory", () => {
  it("sums processed tokens without double counting reasoning tokens", () => {
    const totals = deriveProviderUsageHistory(onlyHost(SAMPLE));

    expect(totals.uncachedInputTokens).toBe(3_500);
    expect(totals.cachedInputTokens).toBe(4_000);
    expect(totals.cacheCreationTokens).toBe(500);
    expect(totals.outputTokens).toBe(3_500);
    expect(totals.totalTokens).toBe(11_500);
    expect(totals.costUsd).toBe(6);
    expect(totals.cacheSavingsUsd).toBe(1);
  });

  it("counts sessions from the sources, not the buckets", () => {
    const totals = deriveProviderUsageHistory(onlyHost(SAMPLE));

    expect(totals.sessions).toBe(8);
    expect(totals.providers.map((entry) => entry.sessions)).toEqual([5, 3]);
  });

  it("orders providers canonically and reports both shares", () => {
    const totals = deriveProviderUsageHistory(onlyHost(SAMPLE));

    expect(totals.providerOrder).toEqual(["claude", "codex"]);
    expect(totals.providers.map((entry) => entry.provider)).toEqual(["claude", "codex"]);
    expect(totals.providers[0]?.costShare).toBeCloseTo(4 / 6);
    expect(totals.providers[1]?.tokenShare).toBeCloseTo(3_000 / 11_500);
  });

  it("appends an unknown provider after the contract's own", () => {
    const totals = deriveProviderUsageHistory(
      onlyHost(
        payload(
          [bucket({ day: "2026-09-06", provider: "grok", model: "grok-4", costUsd: 1 })],
          [source("grok", 2)],
        ),
      ),
    );

    expect(totals.providerOrder).toEqual(["claude", "codex", "grok"]);
    expect(totals.providers.map((entry) => entry.provider)).toEqual(["grok"]);
  });

  it("keeps a provider whose source is missing out of the rows", () => {
    const totals = deriveProviderUsageHistory(
      onlyHost(
        payload(
          [bucket({ day: "2026-09-06", provider: "claude", model: "sonnet-5", costUsd: 1 })],
          [source("claude", 1), source("codex", 0, "missing")],
        ),
      ),
    );

    expect(totals.providers.map((entry) => entry.provider)).toEqual(["claude"]);
  });

  it("groups models by provider and sorts them by cost", () => {
    const totals = deriveProviderUsageHistory(onlyHost(SAMPLE));

    expect(totals.models.map((model) => [model.provider, model.model, model.costUsd])).toEqual([
      ["claude", "sonnet-5", 4],
      ["codex", "gpt-5", 2],
    ]);
    expect(totals.models[0]?.costShare).toBeCloseTo(4 / 6);
  });

  it("collapses buckets into ascending days with per-provider values", () => {
    const totals = deriveProviderUsageHistory(onlyHost(SAMPLE));

    expect(totals.daily.map((day) => day.day)).toEqual(["2026-09-05", "2026-09-07"]);
    expect(totals.daily[1]?.costUsd).toBe(3);
    expect(totals.daily[1]?.byProvider.get("codex")).toEqual({
      costUsd: 2,
      totalTokens: 3_000,
      unpricedRecords: 0,
    });
  });

  it("preserves incomplete pricing through every total and chart readout", () => {
    const totals = deriveProviderUsageHistory(
      onlyHost(
        payload(
          [
            bucket({
              day: "2026-09-07",
              provider: "claude",
              model: "unknown",
              costUsd: 2,
              records: 2,
              unpricedRecords: 1,
              outputTokens: 100,
              costSource: "unpriced",
            }),
          ],
          [source("claude", 1)],
        ),
      ),
    );
    expect(totals.unpricedRecords).toBe(1);
    expect(totals.costUsd).toBe(2);
    expect(totals.totalTokens).toBe(100);
    expect(totals.providers[0]?.unpricedRecords).toBe(1);
    expect(totals.providers[0]?.costShare).toBeNull();
    expect(totals.models[0]?.unpricedRecords).toBe(1);
    expect(totals.models[0]?.costShare).toBeNull();
    expect(totals.daily[0]?.unpricedRecords).toBe(1);
    expect(totals.daily[0]?.byProvider.get("claude")?.unpricedRecords).toBe(1);
    const columns = buildChartColumns(["2026-09-07"], totals.daily, ["claude"], "cost");
    expect(columns[0]?.unpricedRecords).toBe(1);
    expect(columns[0]?.bands[0]?.unpricedRecords).toBe(1);
  });

  it("rolls two configured providers of one kind into the kind and into their own rows", () => {
    const totals = deriveProviderUsageHistory(
      onlyHost(
        payload(
          [
            bucket({
              day: "2026-09-06",
              provider: "codex",
              providerId: "codex",
              model: "gpt-5",
              outputTokens: 1_000,
              costUsd: 1,
            }),
            bucket({
              day: "2026-09-06",
              provider: "codex",
              providerId: "codex-colonel",
              model: "gpt-5",
              outputTokens: 3_000,
              costUsd: 3,
            }),
          ],
          [
            configuredSource("codex", "codex", "Codex", 2),
            configuredSource("codex", "codex-colonel", "Codex (Colonel)", 4),
          ],
        ),
      ),
    );

    expect(
      totals.providers.map((entry) => [entry.provider, entry.costUsd, entry.sessions]),
    ).toEqual([["codex", 4, 6]]);
    expect(
      totals.configuredProviders.map((entry) => [
        entry.providerId,
        entry.provider,
        entry.label,
        entry.costUsd,
        entry.totalTokens,
        entry.sessions,
      ]),
    ).toEqual([
      ["codex-colonel", "codex", "Codex (Colonel)", 3, 3_000, 4],
      ["codex", "codex", "Codex", 1, 1_000, 2],
    ]);
    expect(totals.configuredProviders[0]?.costShare).toBeCloseTo(3 / 4);
    expect(totals.configuredProviders[0]?.tokenShare).toBeCloseTo(3_000 / 4_000);
  });

  it("attributes everything to the base kind when the daemon sends no configured ids", () => {
    const totals = deriveProviderUsageHistory(onlyHost(SAMPLE));

    expect(
      totals.configuredProviders.map((entry) => [entry.providerId, entry.label, entry.costUsd]),
    ).toEqual([
      ["claude", "Claude Code", 4],
      ["codex", "Codex", 2],
    ]);
    expect([...configuredProvidersByKind(totals.configuredProviders).keys()]).toEqual([
      "claude",
      "codex",
    ]);
  });

  it("names a failed home so the missing tokens are visible, and stays quiet for a missing one", () => {
    const failed = deriveProviderUsageHistory(
      onlyHost(
        payload(
          [
            bucket({
              day: "2026-09-06",
              provider: "codex",
              providerId: "codex",
              model: "gpt-5",
              costUsd: 1,
            }),
          ],
          [
            configuredSource("codex", "codex", "Codex", 1),
            configuredSource("codex", "codex-ben", "Codex (Ben)", 0, "failed"),
          ],
        ),
      ),
    );
    expect(failed.unreadableProviders).toEqual(["Codex (Ben)"]);

    const missing = deriveProviderUsageHistory(
      onlyHost(
        payload(
          [
            bucket({
              day: "2026-09-06",
              provider: "codex",
              providerId: "codex",
              model: "gpt-5",
              costUsd: 1,
            }),
          ],
          [
            configuredSource("codex", "codex", "Codex", 1),
            configuredSource("codex", "codex-ben", "Codex (Ben)", 0, "missing"),
          ],
        ),
      ),
    );
    expect(missing.unreadableProviders).toEqual([]);
    expect(missing.configuredProviders.map((entry) => entry.providerId)).toEqual(["codex"]);
  });

  it("reports zero shares for an empty window", () => {
    const totals = deriveProviderUsageHistory(onlyHost(payload([], [source("claude", 0)])));

    expect(totals.costUsd).toBe(0);
    expect(totals.totalTokens).toBe(0);
    expect(totals.providers).toEqual([]);
    expect(totals.configuredProviders).toEqual([]);
    expect(totals.daily).toEqual([]);
  });
});

describe("buildChartColumns", () => {
  it("zero-fills days with no activity and keeps provider order", () => {
    const totals = deriveProviderUsageHistory(onlyHost(SAMPLE));
    const columns = buildChartColumns(
      ["2026-09-05", "2026-09-06", "2026-09-07"],
      totals.daily,
      ["claude", "codex"],
      "cost",
    );

    expect(columns.map((column) => column.total)).toEqual([3, 0, 3]);
    expect(columns[1]?.bands).toEqual([
      { provider: "claude", value: 0, unpricedRecords: 0 },
      { provider: "codex", value: 0, unpricedRecords: 0 },
    ]);
    expect(columns[2]?.bands).toEqual([
      { provider: "claude", value: 1, unpricedRecords: 0 },
      { provider: "codex", value: 2, unpricedRecords: 0 },
    ]);
  });

  it("reads token values when the metric is tokens", () => {
    const totals = deriveProviderUsageHistory(onlyHost(SAMPLE));
    const columns = buildChartColumns(["2026-09-07"], totals.daily, ["codex"], "tokens");

    expect(columns[0]?.total).toBe(3_000);
  });
});

describe("niceScale", () => {
  it("rounds the maximum up to a 1/2/5 step so the peak is not clipped", () => {
    expect(niceScale(37, 4)).toEqual({ max: 40, ticks: [0, 10, 20, 30, 40] });
    expect(niceScale(4.2, 4).max).toBeGreaterThanOrEqual(4.2);
    expect(niceScale(1_100, 4)).toEqual({ max: 1_500, ticks: [0, 500, 1_000, 1_500] });
  });

  it("degenerates to a single tick with no data", () => {
    expect(niceScale(0, 4)).toEqual({ max: 0, ticks: [0] });
  });
});

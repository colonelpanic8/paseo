import {
  BREAKDOWN_DIMENSIONS,
  deriveChartBreakdown,
  deriveUsageBreakdown,
  sortBreakdown,
} from "./breakdown";
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
    expect(totals.models[0]?.unpricedRecords).toBe(1);
    // Shares are taken over priced cost, so an unpriced record adds nothing to
    // either side of the ratio and the summary footnote owns the caveat.
    expect(totals.providers[0]?.costShare).toBe(1);
    expect(totals.models[0]?.costShare).toBe(1);
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

describe("combined usage breakdown", () => {
  const input = payload(
    [
      bucket({
        day: "2026-09-05",
        provider: "codex",
        providerId: "personal",
        model: "shared",
        costUsd: 3,
        outputTokens: 10,
      }),
      bucket({
        day: "2026-09-06",
        provider: "codex",
        providerId: "personal",
        model: "shared",
        costUsd: 1,
        outputTokens: 20,
        unpricedRecords: 1,
      }),
      bucket({
        day: "2026-09-05",
        provider: "codex",
        providerId: "work",
        model: "shared",
        costUsd: 2,
        outputTokens: 30,
      }),
      bucket({
        day: "2026-09-05",
        provider: "codex",
        providerId: "work",
        model: "other",
        costUsd: 4,
        outputTokens: 40,
      }),
    ],
    [
      configuredSource("codex", "personal", "Personal", 1),
      configuredSource("codex", "work", "Work", 1),
    ],
  );
  const hosts = [
    ...onlyHost(input),
    { ...onlyHost(input)[0]!, serverId: "host-b", hostName: "Laptop" },
  ];
  const totals = deriveProviderUsageHistory(hosts);

  it("uses only the selected dimensions and preserves totals in all 16 combinations", () => {
    for (let mask = 0; mask < 16; mask++) {
      const dimensions = BREAKDOWN_DIMENSIONS.filter((_, index) => (mask & (1 << index)) !== 0);
      const grouped = deriveUsageBreakdown(totals, dimensions);
      const expectedCounts = [1, 2, 4, 4, 2, 4, 6, 6, 2, 4, 6, 6, 3, 6, 8, 8];
      expect(grouped.rows).toHaveLength(expectedCounts[mask]);
      expect(grouped.rows.reduce((sum, row) => sum + row.costUsd, 0)).toBe(20);
      expect(grouped.rows.reduce((sum, row) => sum + row.totalTokens, 0)).toBe(200);
      expect(grouped.rows.reduce((sum, row) => sum + row.unpricedRecords, 0)).toBe(2);
      const columns = buildChartColumns(
        ["2026-09-05", "2026-09-06", "2026-09-07"],
        grouped.daily,
        grouped.rows.map((row) => row.key),
        "cost",
      );
      expect(columns.map((column) => column.total)).toEqual([18, 2, 0]);
      for (const row of grouped.rows) {
        let chartTotal = 0;
        for (const column of columns) {
          chartTotal += column.bands.find((band) => band.provider === row.key)?.value ?? 0;
        }
        expect(chartTotal).toBe(row.costUsd);
      }
    }
  });

  it("combines matching model names and separates configured providers and hosts when selected", () => {
    expect(deriveUsageBreakdown(totals, ["model"]).rows).toHaveLength(2);
    expect(deriveUsageBreakdown(totals, ["host", "model"]).rows).toHaveLength(4);
    const combined = deriveUsageBreakdown(totals, ["provider", "model"]);
    expect(combined.rows).toHaveLength(6);
    expect(combined.rows.find((row) => row.label === "Personal · Laptop · shared")?.costUsd).toBe(
      4,
    );
    expect(deriveUsageBreakdown(totals, ["day", "provider", "model", "host"]).rows).toHaveLength(8);
    expect(deriveUsageBreakdown(totals, []).rows).toMatchObject([
      { costUsd: 20, totalTokens: 200 },
    ]);
  });

  it("does not restore buckets from a deduplicated source", () => {
    const deduplicated = deriveProviderUsageHistory([
      ...onlyHost(input),
      { ...hosts[1]!, countedSources: [input.sources[0]!] },
    ]);
    const grouped = deriveUsageBreakdown(deduplicated, ["host", "provider", "model"]);
    expect(grouped.rows.reduce((sum, row) => sum + row.costUsd, 0)).toBe(14);
    expect(grouped.rows.filter((row) => row.label.startsWith("Laptop"))).toHaveLength(1);
  });

  it("keeps chart series and colors unchanged when grouping the table by day", () => {
    for (const dimensions of [[], ["model"], ["host", "provider", "model"]] as const) {
      expect(deriveChartBreakdown(totals, [...dimensions, "day"])).toEqual(
        deriveChartBreakdown(totals, dimensions),
      );
    }
  });

  it("sorts combined groups chronologically across model and host labels", () => {
    const rows = deriveUsageBreakdown(totals, ["host", "model", "day"]).rows;
    const days = rows.map((row) => row.day).sort();
    expect(new Set(days).size).toBeGreaterThan(1);
    expect(sortBreakdown(rows, "day", "ascending").map((row) => row.day)).toEqual(days);
    expect(sortBreakdown(rows, "day", "descending").map((row) => row.day)).toEqual(
      days.toReversed(),
    );
  });

  it("sorts by group, cost, or tokens in either direction without changing colors or input", () => {
    const rows = deriveUsageBreakdown(totals, ["model"]).rows;
    for (const sort of ["label", "costUsd", "totalTokens"] as const) {
      const ascending = sortBreakdown(rows, sort, "ascending");
      const descending = sortBreakdown(rows, sort, "descending");
      expect(ascending.map((row) => row.key)).toEqual(
        descending.map((row) => row.key).toReversed(),
      );
      expect(ascending).not.toBe(rows);
      expect(ascending.every((row) => rows.includes(row))).toBe(true);
    }
    expect(sortBreakdown(rows, "costUsd", "descending")[0]?.label).toBe("shared");
    expect(sortBreakdown(rows, "label", "ascending")[0]?.label).toBe("other");
    expect(deriveUsageBreakdown(totals, ["host", "model"])).toEqual(
      deriveUsageBreakdown(totals, ["model", "host"]),
    );
  });
});

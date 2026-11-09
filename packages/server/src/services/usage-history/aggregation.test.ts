import { describe, expect, it } from "vitest";
import {
  makeDayFormatter,
  makeDayResolver,
  UsageAggregator,
  type UsageDayWindow,
} from "./aggregation.js";
import type { RateTable } from "./pricing.js";
import type { UsageRecord } from "./transcripts.js";

const rates: RateTable = new Map([
  [
    "claude-fable-5",
    {
      inputCostPerToken: 1e-5,
      outputCostPerToken: 5e-5,
      cacheReadCostPerToken: 1e-6,
      cacheCreationCostPerToken: 1.25e-5,
    },
  ],
]);

function record(overrides: Partial<UsageRecord> = {}): UsageRecord {
  return {
    provider: "claude",
    timestampMs: Date.parse("2026-08-07T04:05:13.944Z"),
    model: "claude-fable-5",
    sessionId: "session-a",
    totals: {
      uncachedInputTokens: 100,
      cachedInputTokens: 1000,
      cacheCreationTokens: 10,
      outputTokens: 50,
      reasoningTokens: 0,
    },
    reportedCostUsd: null,
    dedupeKey: null,
    ...overrides,
  };
}

function aggregate(records: readonly UsageRecord[], timeZone = "UTC", providerId?: string) {
  const aggregator = new UsageAggregator({
    timeZone,
    sinceDay: "2026-08-01",
    untilDay: "2026-08-31",
    rates,
  });
  for (const item of records) aggregator.add(item, providerId ?? item.provider);
  return aggregator.finish();
}

describe("UsageAggregator", () => {
  it("keeps only the first record for a repeated global dedupe key", () => {
    const result = aggregate([
      record({ dedupeKey: "msg_1:" }),
      record({ dedupeKey: "msg_1:" }),
      record({ dedupeKey: "msg_1:" }),
    ]);
    expect(result.duplicatesDropped).toBe(2);
    expect(result.buckets).toHaveLength(1);
    expect(result.buckets[0]?.records).toBe(1);
  });

  it("still sums records without dedupe keys", () => {
    const result = aggregate([record(), record()]);
    expect(result.duplicatesDropped).toBe(0);
    expect(result.buckets[0]?.totals.outputTokens).toBe(100);
  });

  it("buckets by the day in the requested time zone", () => {
    expect(aggregate([record()], "UTC").buckets[0]?.day).toBe("2026-08-07");
    expect(aggregate([record()], "America/Los_Angeles").buckets[0]?.day).toBe("2026-08-06");
  });

  it("prices records and computes cache savings", () => {
    const bucket = aggregate([record()]).buckets[0];
    expect(bucket?.costUsd).toBeCloseTo(0.004625, 9);
    expect(bucket?.cacheSavingsUsd).toBeCloseTo(0.009, 9);
    expect(bucket?.costSource).toBe("modelPriced");
  });

  it("counts tokens but not cost for an unknown model", () => {
    const bucket = aggregate([record({ model: "kimi-k3" })]).buckets[0];
    expect(bucket?.costUsd).toBe(0);
    expect(bucket?.costSource).toBe("unpriced");
    expect(bucket?.unpricedRecords).toBe(1);
    expect(bucket?.totals.outputTokens).toBe(50);
  });

  it("prefers provider-reported cost", () => {
    const bucket = aggregate([record({ reportedCostUsd: 1.25 })]).buckets[0];
    expect(bucket?.costUsd).toBe(1.25);
    expect(bucket?.costSource).toBe("providerReported");
  });

  it("splits accounts of one kind into their own buckets", () => {
    const aggregator = new UsageAggregator({
      timeZone: "UTC",
      sinceDay: "2026-08-01",
      untilDay: "2026-08-31",
      rates,
    });
    aggregator.add(record({ provider: "codex" }), "codex-ben");
    aggregator.add(record({ provider: "codex" }), "codex-colonel");
    const buckets = aggregator.finish().buckets;
    expect(buckets.map((bucket) => [bucket.provider, bucket.providerId])).toEqual([
      ["codex", "codex-ben"],
      ["codex", "codex-colonel"],
    ]);
  });

  it("uses the weakest cost provenance for a mixed bucket", () => {
    const mixed = aggregate([record({ reportedCostUsd: 1 }), record()]).buckets[0];
    expect(mixed?.costSource).toBe("modelPriced");
  });

  it("marks partially priced buckets as unpriced and keeps the known subtotal", () => {
    const bucket = aggregate([
      record({ model: "unknown", reportedCostUsd: 2 }),
      record({ model: "unknown" }),
    ]).buckets[0];
    expect(bucket?.costSource).toBe("unpriced");
    expect(bucket?.unpricedRecords).toBe(1);
    expect(bucket?.costUsd).toBe(2);
  });

  it("rejects invalid time zones instead of substituting UTC", () => {
    expect(() => aggregate([record()], "Not/AZone")).toThrow(RangeError);
  });

  it("drops records outside the window and reports whether records contributed", () => {
    const aggregator = new UsageAggregator({
      timeZone: "UTC",
      sinceDay: "2026-08-01",
      untilDay: "2026-08-31",
      rates,
    });
    expect(aggregator.add(record({ dedupeKey: "msg_1:" }), "claude")).toBe(true);
    expect(aggregator.add(record({ dedupeKey: "msg_1:" }), "claude")).toBe(false);
    expect(
      aggregator.add(record({ timestampMs: Date.parse("2026-07-01T12:00:00Z") }), "claude"),
    ).toBe(false);
    expect(aggregator.finish().outOfWindow).toBe(1);
  });

  it("separates providers and models into stable bucket order", () => {
    const result = aggregate([
      record({ model: "z-model" }),
      record({ provider: "codex", model: "gpt-5.6-sol" }),
      record({ model: "a-model" }),
    ]);
    expect(result.buckets.map((bucket) => [bucket.provider, bucket.model])).toEqual([
      ["claude", "a-model"],
      ["claude", "z-model"],
      ["codex", "gpt-5.6-sol"],
    ]);
  });
});

/** Windows that bracket a DST transition, including one whose local midnight does not exist. */
const DAY_RESOLVER_WINDOWS: readonly UsageDayWindow[] = [
  { timeZone: "UTC", sinceDay: "2026-08-01", untilDay: "2026-08-03" },
  { timeZone: "Asia/Kolkata", sinceDay: "2026-08-01", untilDay: "2026-08-03" },
  { timeZone: "America/Los_Angeles", sinceDay: "2026-03-06", untilDay: "2026-03-10" },
  { timeZone: "America/Los_Angeles", sinceDay: "2026-10-30", untilDay: "2026-11-03" },
  { timeZone: "America/Santiago", sinceDay: "2026-09-04", untilDay: "2026-09-08" },
  { timeZone: "Pacific/Chatham", sinceDay: "2026-09-25", untilDay: "2026-09-29" },
  { timeZone: "Australia/Lord_Howe", sinceDay: "2026-04-03", untilDay: "2026-04-07" },
  { timeZone: "Pacific/Kiritimati", sinceDay: "2026-08-01", untilDay: "2026-08-01" },
];

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * 60 * 1000;

describe("makeDayResolver", () => {
  it("places every minute of a window exactly where the formatter does", () => {
    const mismatches: string[] = [];
    for (const window of DAY_RESOLVER_WINDOWS) {
      const resolve = makeDayResolver(window);
      const toDay = makeDayFormatter(window.timeZone);
      const from = Date.parse(`${window.sinceDay}T00:00:00Z`) - 2 * DAY_MS;
      const to = Date.parse(`${window.untilDay}T00:00:00Z`) + 3 * DAY_MS;
      for (let timestampMs = from; timestampMs <= to; timestampMs += MINUTE_MS) {
        const day = toDay(timestampMs);
        const expected = day >= window.sinceDay && day <= window.untilDay ? day : null;
        if (resolve(timestampMs) !== expected) {
          mismatches.push(`${window.timeZone} ${new Date(timestampMs).toISOString()}`);
        }
      }
    }
    expect(mismatches).toEqual([]);
  });

  it("reports a timestamp that is not a date as outside the window", () => {
    const resolve = makeDayResolver({
      timeZone: "UTC",
      sinceDay: "2026-08-01",
      untilDay: "2026-08-31",
    });
    expect(resolve(Number.NaN)).toBeNull();
  });
});

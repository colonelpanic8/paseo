import type { ProviderUsageHistoryBucket } from "../../server/messages.js";
import { cacheSavingsUsd, priceUsage, type RateTable } from "./pricing.js";
import { addTotals, EMPTY_TOTALS, type UsageRecord, type UsageTokenTotals } from "./transcripts.js";

/** `en-CA` yields ISO-ordered date parts without using host-local Date getters. */
export function makeDayFormatter(timeZone: string): (timestampMs: number) => string {
  const format = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return (timestampMs) => format.format(new Date(timestampMs));
}

interface MutableBucket {
  totals: UsageTokenTotals;
  costUsd: number;
  cacheSavingsUsd: number;
  records: number;
  unpricedRecords: number;
  providerReportedRecords: number;
  sessions: Set<string>;
}

export interface AggregateOptions {
  readonly timeZone: string;
  readonly sinceDay: string;
  readonly untilDay: string;
  readonly rates: RateTable;
}

export interface AggregateResult {
  readonly buckets: readonly ProviderUsageHistoryBucket[];
  readonly duplicatesDropped: number;
  readonly outOfWindow: number;
}

/**
 * De-duplication is global: Claude copies messages into resumed and forked transcript files.
 */
export class UsageAggregator {
  readonly #buckets = new Map<string, MutableBucket>();
  readonly #seen = new Set<string>();
  readonly #toDay: (timestampMs: number) => string;
  readonly #options: AggregateOptions;
  #duplicatesDropped = 0;
  #outOfWindow = 0;

  constructor(options: AggregateOptions) {
    this.#options = options;
    this.#toDay = makeDayFormatter(options.timeZone);
  }

  /**
   * `providerId` is the configured provider owning the transcript home the record came from; it
   * splits accounts of the same kind apart without splitting the chart series.
   *
   * Returns whether the record contributed to the requested window.
   */
  add(record: UsageRecord, providerId: string): boolean {
    if (record.dedupeKey !== null) {
      if (this.#seen.has(record.dedupeKey)) {
        this.#duplicatesDropped += 1;
        return false;
      }
      this.#seen.add(record.dedupeKey);
    }

    const day = this.#toDay(record.timestampMs);
    if (day < this.#options.sinceDay || day > this.#options.untilDay) {
      this.#outOfWindow += 1;
      return false;
    }

    const key = `${day}\u0000${record.provider}\u0000${providerId}\u0000${record.model}`;
    let bucket = this.#buckets.get(key);
    if (bucket === undefined) {
      bucket = {
        totals: EMPTY_TOTALS,
        costUsd: 0,
        cacheSavingsUsd: 0,
        records: 0,
        unpricedRecords: 0,
        providerReportedRecords: 0,
        sessions: new Set<string>(),
      };
      this.#buckets.set(key, bucket);
    }

    const priced = priceUsage(
      this.#options.rates,
      record.model,
      record.totals,
      record.reportedCostUsd,
    );
    bucket.totals = addTotals(bucket.totals, record.totals);
    bucket.costUsd += priced.costUsd;
    bucket.cacheSavingsUsd += cacheSavingsUsd(this.#options.rates, record.model, record.totals);
    bucket.records += 1;
    if (priced.costSource === "unpriced") bucket.unpricedRecords += 1;
    if (priced.costSource === "providerReported") bucket.providerReportedRecords += 1;
    if (record.sessionId.length > 0) bucket.sessions.add(record.sessionId);
    return true;
  }

  finish(): AggregateResult {
    const buckets: ProviderUsageHistoryBucket[] = [];
    for (const [key, bucket] of this.#buckets) {
      const [day = "", provider = "", providerId = "", model = ""] = key.split("\u0000");
      buckets.push({
        day,
        provider,
        providerId,
        model,
        totals: bucket.totals,
        costUsd: bucket.costUsd,
        cacheSavingsUsd: bucket.cacheSavingsUsd,
        costSource: resolveCostSource(bucket),
        records: bucket.records,
        unpricedRecords: bucket.unpricedRecords,
        sessions: bucket.sessions.size,
      });
    }
    buckets.sort(
      (a, b) =>
        a.day.localeCompare(b.day) ||
        a.provider.localeCompare(b.provider) ||
        (a.providerId ?? "").localeCompare(b.providerId ?? "") ||
        a.model.localeCompare(b.model),
    );
    return {
      buckets,
      duplicatesDropped: this.#duplicatesDropped,
      outOfWindow: this.#outOfWindow,
    };
  }
}

/** The weakest cost provenance in a mixed bucket wins. */
function resolveCostSource(bucket: MutableBucket): ProviderUsageHistoryBucket["costSource"] {
  if (bucket.unpricedRecords > 0) return "unpriced";
  if (bucket.providerReportedRecords === bucket.records) return "providerReported";
  return "modelPriced";
}

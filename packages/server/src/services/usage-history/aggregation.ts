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

const DAY_MS = 24 * 60 * 60 * 1000;
/** No zone puts a local day's first instant further than this from its UTC midnight. */
const BOUNDARY_SLACK_MS = 26 * 60 * 60 * 1000;

function nextDay(day: string): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + DAY_MS).toISOString().slice(0, 10);
}

/**
 * First instant that belongs to `day`, found by bisecting the formatter rather than by adding a
 * zone offset: the offset is not constant across a day, and a day whose local midnight does not
 * exist at all — the hour a spring-forward skips — still has a first instant.
 */
function dayStartMs(day: string, toDay: (timestampMs: number) => string): number {
  const utcMidnight = Date.parse(`${day}T00:00:00Z`);
  let low = utcMidnight - BOUNDARY_SLACK_MS;
  let high = utcMidnight + BOUNDARY_SLACK_MS;
  while (low < high) {
    const mid = low + Math.floor((high - low) / 2);
    if (toDay(mid) < day) low = mid + 1;
    else high = mid;
  }
  return low;
}

export type UsageDayResolver = (timestampMs: number) => string | null;

export interface UsageDayWindow {
  readonly timeZone: string;
  readonly sinceDay: string;
  readonly untilDay: string;
}

/**
 * Places a timestamp on its local day, or reports it outside the window. Formatting every record
 * costs an `Intl` call each; the window is at most 90 days, so its boundaries are worth resolving
 * once and comparing against.
 */
export function makeDayResolver(window: UsageDayWindow): UsageDayResolver {
  const toDay = makeDayFormatter(window.timeZone);
  const days: string[] = [];
  for (let day = window.sinceDay; day <= window.untilDay; day = nextDay(day)) days.push(day);

  if (days.length === 0) return () => null;

  const starts = days.map((day) => dayStartMs(day, toDay));
  const windowStartMs = starts[0];
  const windowEndMs = dayStartMs(nextDay(window.untilDay), toDay);

  return (timestampMs) => {
    // Negated so a `NaN` timestamp falls outside the window rather than past its start.
    if (!(timestampMs >= windowStartMs) || timestampMs >= windowEndMs) return null;
    let low = 0;
    let high = starts.length - 1;
    while (low < high) {
      const mid = Math.ceil((low + high) / 2);
      if (starts[mid] <= timestampMs) low = mid;
      else high = mid - 1;
    }
    return days[low];
  };
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
  readonly #toDay: UsageDayResolver;
  readonly #options: AggregateOptions;
  #duplicatesDropped = 0;
  #outOfWindow = 0;

  constructor(options: AggregateOptions) {
    this.#options = options;
    this.#toDay = makeDayResolver(options);
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
    if (day === null) {
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

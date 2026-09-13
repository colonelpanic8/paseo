import { IDENTITY_COLOR_NAMES, type IdentityColorName } from "@/styles/identity-colors";
import type { ProviderUsageHistoryDayTotals, ProviderUsageHistoryTotals } from "./derive";

export const BREAKDOWN_DIMENSIONS = ["host", "provider", "model", "day"] as const;
export type BreakdownDimension = (typeof BREAKDOWN_DIMENSIONS)[number];
export type BreakdownSort = "label" | "day" | "costUsd" | "totalTokens";
export type SortDirection = "ascending" | "descending";
export type TimeGrouping = "day" | "week" | "month";

export function timePeriodStart(day: string, grouping: TimeGrouping): string {
  if (grouping === "day") return day;
  if (grouping === "month") return `${day.slice(0, 7)}-01`;
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
  return date.toISOString().slice(0, 10);
}

export function timePeriodLabel(start: string, grouping: TimeGrouping): string {
  if (grouping === "day") return start;
  if (grouping === "month") return start.slice(0, 7);
  const end = new Date(`${start}T00:00:00Z`);
  end.setUTCDate(end.getUTCDate() + 6);
  return `${start} – ${end.toISOString().slice(0, 10)}`;
}

export interface BreakdownSortCriterion {
  field: BreakdownSort;
  direction: SortDirection;
}

export interface BreakdownRow {
  colorName: IdentityColorName;
  key: string;
  label: string;
  day: string;
  costUsd: number;
  totalTokens: number;
  unpricedRecords: number;
  costShare: number;
  tokenShare: number;
}

export interface UsageBreakdown {
  rows: readonly BreakdownRow[];
  daily: readonly ProviderUsageHistoryDayTotals[];
}

export function deriveUsageBreakdown(
  totals: ProviderUsageHistoryTotals,
  selected: readonly BreakdownDimension[],
  timeGrouping: TimeGrouping = "day",
): UsageBreakdown {
  const dimensions = BREAKDOWN_DIMENSIONS.filter((dimension) => selected.includes(dimension));
  const rows = new Map<string, BreakdownRow>();
  const days = new Map<string, Map<string, BreakdownRow>>();
  for (const entry of totals.entries) {
    const { bucket, serverId, hostName } = entry;
    const providerId = bucket.providerId ?? bucket.provider;
    const periodStart = timePeriodStart(bucket.day, timeGrouping);
    // Match by kind and configured id; transcripts cannot establish account identity.
    const identity = {
      host: serverId,
      provider: [bucket.provider, providerId],
      model: bucket.model,
      day: periodStart,
    };
    const display = {
      host: hostName,
      provider: entry.providerLabel,
      model: bucket.model,
      day: timePeriodLabel(periodStart, timeGrouping),
    };
    const key = JSON.stringify(dimensions.map((dimension) => identity[dimension]));
    const label = dimensions.map((dimension) => display[dimension]).join(" · ");
    const empty: BreakdownRow = {
      colorName: "violet",
      key,
      label,
      day: selected.includes("day") ? periodStart : "",
      costUsd: 0,
      totalTokens: 0,
      unpricedRecords: 0,
      costShare: 0,
      tokenShare: 0,
    };
    const row = rows.get(key) ?? { ...empty };
    const day = days.get(bucket.day) ?? new Map<string, BreakdownRow>();
    const dailyRow = day.get(key) ?? { ...empty };
    const tokens =
      bucket.totals.uncachedInputTokens +
      bucket.totals.cachedInputTokens +
      bucket.totals.cacheCreationTokens +
      bucket.totals.outputTokens;
    for (const target of [row, dailyRow]) {
      target.costUsd += bucket.costUsd;
      target.totalTokens += tokens;
      target.unpricedRecords += bucket.unpricedRecords;
    }
    rows.set(key, row);
    day.set(key, dailyRow);
    days.set(bucket.day, day);
  }
  const ordered = [...rows.values()].sort((left, right) => left.key.localeCompare(right.key));
  for (const [index, row] of ordered.entries()) {
    row.colorName = IDENTITY_COLOR_NAMES[index % IDENTITY_COLOR_NAMES.length];
    row.costShare = totals.costUsd === 0 ? 0 : row.costUsd / totals.costUsd;
    row.tokenShare = totals.totalTokens === 0 ? 0 : row.totalTokens / totals.totalTokens;
  }
  const daily = [...days].map(([day, byProvider]) => {
    const entries = [...byProvider.values()];
    return {
      day,
      byProvider,
      costUsd: entries.reduce((sum, value) => sum + value.costUsd, 0),
      totalTokens: entries.reduce((sum, value) => sum + value.totalTokens, 0),
      unpricedRecords: entries.reduce((sum, value) => sum + value.unpricedRecords, 0),
    };
  });
  return { rows: [...rows.values()], daily };
}

export function sortBreakdown(
  rows: readonly BreakdownRow[],
  criteria: readonly BreakdownSortCriterion[],
): BreakdownRow[] {
  return [...rows].sort((left, right) => {
    for (const { field, direction } of criteria) {
      const comparison =
        field === "label" || field === "day"
          ? left[field].localeCompare(right[field])
          : left[field] - right[field];
      if (comparison !== 0) return (direction === "ascending" ? 1 : -1) * comparison;
    }
    return left.key.localeCompare(right.key);
  });
}

export function deriveChartBreakdown(
  totals: ProviderUsageHistoryTotals,
  selected: readonly BreakdownDimension[],
): UsageBreakdown {
  return deriveUsageBreakdown(
    totals,
    selected.filter((dimension) => dimension !== "day"),
  );
}

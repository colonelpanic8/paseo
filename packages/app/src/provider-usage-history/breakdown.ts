import { IDENTITY_COLOR_NAMES, type IdentityColorName } from "@/styles/identity-colors";
import type { ProviderUsageHistoryDayTotals, ProviderUsageHistoryTotals } from "./derive";

export const BREAKDOWN_DIMENSIONS = ["host", "provider", "model", "day"] as const;
export type BreakdownDimension = (typeof BREAKDOWN_DIMENSIONS)[number];
export type BreakdownSort = "label" | "day" | "costUsd" | "totalTokens";
export type SortDirection = "ascending" | "descending";

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
): UsageBreakdown {
  const dimensions = BREAKDOWN_DIMENSIONS.filter((dimension) => selected.includes(dimension));
  const rows = new Map<string, BreakdownRow>();
  const days = new Map<string, Map<string, BreakdownRow>>();
  for (const entry of totals.entries) {
    const { bucket, serverId, hostName } = entry;
    const providerId = bucket.providerId ?? bucket.provider;
    // Configured providers belong to a host, even when Host is not selected.
    const identity = {
      host: serverId,
      provider: [serverId, providerId],
      model: bucket.model,
      day: bucket.day,
    };
    const qualifyProvider = totals.hosts.length > 1 && !selected.includes("host");
    const provider = qualifyProvider ? `${entry.providerLabel} · ${hostName}` : entry.providerLabel;
    const display = { host: hostName, provider, model: bucket.model, day: bucket.day };
    const key = JSON.stringify(dimensions.map((dimension) => identity[dimension]));
    const label = dimensions.map((dimension) => display[dimension]).join(" · ");
    const empty: BreakdownRow = {
      colorName: "violet",
      key,
      label,
      day: selected.includes("day") ? bucket.day : "",
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
  sort: BreakdownSort,
  direction: SortDirection,
): BreakdownRow[] {
  const sign = direction === "ascending" ? 1 : -1;
  return [...rows].sort((left, right) => {
    const comparison =
      sort === "label" || sort === "day"
        ? left[sort].localeCompare(right[sort])
        : left[sort] - right[sort];
    return sign * comparison || left.key.localeCompare(right.key);
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

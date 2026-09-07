/**
 * Geometry inputs for the daily chart: one zero-filled column per day in the
 * window, and a readable y-axis scale.
 *
 * @module chart-data
 */
import type { ProviderUsageHistoryDayTotals } from "./derive";
import type { ProviderUsageHistoryMetric } from "./types";

export interface ProviderUsageHistoryChartBand {
  readonly provider: string;
  readonly value: number;
  readonly unpricedRecords: number;
}

export interface ProviderUsageHistoryChartColumn {
  readonly day: string;
  /** In the given provider order, i.e. bottom of the stack first. */
  readonly bands: readonly ProviderUsageHistoryChartBand[];
  readonly total: number;
  readonly unpricedRecords: number;
}

export interface ProviderUsageHistoryScale {
  readonly max: number;
  readonly ticks: readonly number[];
}

/** One column per day in the window, zero-filled where nothing happened. */
export function buildChartColumns(
  days: readonly string[],
  daily: readonly ProviderUsageHistoryDayTotals[],
  providers: readonly string[],
  metric: ProviderUsageHistoryMetric,
): readonly ProviderUsageHistoryChartColumn[] {
  const byDay = new Map(daily.map((totals) => [totals.day, totals]));
  return days.map((day) => {
    const totals = byDay.get(day);
    const bands = providers.map((provider) => {
      const entry = totals?.byProvider.get(provider) ?? {
        costUsd: 0,
        totalTokens: 0,
        unpricedRecords: 0,
      };
      return {
        provider,
        value: metric === "cost" ? entry.costUsd : entry.totalTokens,
        unpricedRecords: entry.unpricedRecords,
      };
    });
    return {
      day,
      bands,
      unpricedRecords: bands.reduce((sum, band) => sum + band.unpricedRecords, 0),
      total: bands.reduce((sum, band) => sum + band.value, 0),
    };
  });
}

function stepMultiple(normalized: number): number {
  if (normalized > 5) return 10;
  if (normalized > 2) return 5;
  if (normalized > 1) return 2;
  return 1;
}

/**
 * A scale whose maximum is a readable 1/2/5 x 10^n step at or above the peak.
 *
 * Rounding the maximum *up* is the point: stopping at the last step below the
 * peak leaves the tallest day drawn past the top of the plot, where it is
 * clipped.
 */
export function niceScale(peak: number, count: number): ProviderUsageHistoryScale {
  if (peak <= 0) return { max: 0, ticks: [0] };

  const rawStep = peak / count;
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const normalized = rawStep / magnitude;
  const step = stepMultiple(normalized) * magnitude;

  const max = Math.ceil(peak / step) * step;
  const ticks: number[] = [];
  for (let value = 0; value <= max + step * 1e-6; value += step) ticks.push(value);
  return { max, ticks };
}

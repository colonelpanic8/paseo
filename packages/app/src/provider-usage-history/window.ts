/**
 * Window arithmetic and display formatting for the usage-history page.
 *
 * Formatting is pinned to en-US: costs, token counts, and day labels are data
 * read off the provider transcripts, and a column of them has to line up the
 * same way in every locale.
 */

export interface ProviderUsageHistoryWindow {
  readonly sinceDay: string;
  readonly untilDay: string;
  readonly timeZone: string;
}

const CURRENCY = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const INTEGER = new Intl.NumberFormat("en-US");

const DAY_LABEL = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});

const DAY_MS = 86_400_000;

export function formatUsd(value: number): string {
  return CURRENCY.format(value);
}

export function formatCount(value: number): string {
  return INTEGER.format(Math.round(value));
}

function significantDigits(magnitude: number): number {
  if (magnitude >= 100) return 0;
  if (magnitude >= 10) return 1;
  return 2;
}

function trimSignificant(value: number): string {
  return value.toFixed(significantDigits(Math.abs(value))).replace(/\.0+$/, "");
}

/**
 * Compacts a token count to three significant figures with a unit suffix, so
 * columns of numbers line up at a glance (`19.9B`, `76.7M`, `804K`).
 */
export function formatTokens(value: number): string {
  const magnitude = Math.abs(value);
  if (magnitude >= 1e12) return `${trimSignificant(value / 1e12)}T`;
  if (magnitude >= 1e9) return `${trimSignificant(value / 1e9)}B`;
  if (magnitude >= 1e6) return `${trimSignificant(value / 1e6)}M`;
  if (magnitude >= 1e3) return `${trimSignificant(value / 1e3)}K`;
  return INTEGER.format(Math.round(value));
}

function trimTrailingZeros(value: number): string {
  return String(Number(value.toFixed(significantDigits(Math.abs(value)))));
}

/**
 * Axis-tick currency: whole dollars below a thousand, then a unit suffix
 * (`$600`, `$1.2K`). Tick values come from `niceScale`, so they never carry
 * cents worth showing.
 */
export function formatUsdCompact(value: number): string {
  const magnitude = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  if (magnitude >= 1e6) return `${sign}$${trimTrailingZeros(magnitude / 1e6)}M`;
  if (magnitude >= 1e3) return `${sign}$${trimTrailingZeros(magnitude / 1e3)}K`;
  return `${sign}$${INTEGER.format(Math.round(magnitude))}`;
}

export function formatPercent(share: number, digits = 1): string {
  return `${(share * 100).toFixed(digits)}%`;
}

/** `2026-08-07` to `Aug 7`. */
export function formatDayShort(day: string): string {
  const instant = Date.parse(`${day}T00:00:00Z`);
  if (Number.isNaN(instant)) return day;
  return DAY_LABEL.format(instant);
}

/** Inclusive day list between two `YYYY-MM-DD` bounds. */
export function enumerateDays(sinceDay: string, untilDay: string): readonly string[] {
  const start = Date.parse(`${sinceDay}T00:00:00Z`);
  const end = Date.parse(`${untilDay}T00:00:00Z`);
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return [];

  const days: string[] = [];
  for (let cursor = start; cursor <= end; cursor += DAY_MS) {
    days.push(new Date(cursor).toISOString().slice(0, 10));
  }
  return days;
}

function dayFormatter(timeZone: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

/**
 * The window the page requests, expressed in the viewer's own time zone so days
 * line up with what they actually experienced.
 */
export function makeWindow(days: number, now = new Date()): ProviderUsageHistoryWindow {
  const resolved = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  let timeZone = resolved;
  let format: Intl.DateTimeFormat;
  try {
    format = dayFormatter(resolved);
  } catch {
    // Hermes can resolve a zone name its bundled ICU data cannot format.
    timeZone = "UTC";
    format = dayFormatter("UTC");
  }

  const untilDay = format.format(now);
  // Subtracting fixed milliseconds from `now` lands on the wrong calendar day
  // around a DST transition. The start is calendar arithmetic on the local end
  // day, done in UTC where every day is the same length.
  const [year = 0, month = 1, dayOfMonth = 1] = untilDay
    .split("-")
    .map((part) => Number.parseInt(part, 10));
  const start = new Date(Date.UTC(year, month - 1, dayOfMonth - (days - 1)));

  return { sinceDay: start.toISOString().slice(0, 10), untilDay, timeZone };
}

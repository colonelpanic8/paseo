import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  enumerateDays,
  formatPeriodLong,
  formatPeriodShort,
  formatCount,
  formatDayShort,
  formatPercent,
  formatTokens,
  formatUsd,
  formatUsdCompact,
  makeWindow,
  msUntilNextLocalDay,
} from "./window";

// The window is expressed in the viewer's zone, so pin one that observes DST.
const hostTimeZone = process.env.TZ;

beforeAll(() => {
  process.env.TZ = "America/New_York";
});

afterAll(() => {
  if (hostTimeZone === undefined) delete process.env.TZ;
  else process.env.TZ = hostTimeZone;
});

describe("makeWindow", () => {
  it("spans an inclusive window ending on the current local day", () => {
    const window = makeWindow(7, new Date("2026-09-07T12:00:00Z"));

    expect(window.untilDay).toBe("2026-09-07");
    expect(window.sinceDay).toBe("2026-09-01");
    expect(enumerateDays(window.sinceDay, window.untilDay)).toHaveLength(7);
  });

  it("keeps the start day on the calendar across a DST transition", () => {
    // 2026-03-08 is the US spring-forward day, so a 23-hour local day sits
    // inside the window. Subtracting fixed milliseconds would land on Mar 2.
    const window = makeWindow(7, new Date("2026-03-10T12:00:00Z"));

    expect(window.untilDay).toBe("2026-03-10");
    expect(window.sinceDay).toBe("2026-03-04");
  });

  it("reports a resolvable IANA zone", () => {
    const window = makeWindow(30, new Date("2026-09-07T12:00:00Z"));

    expect(() => new Intl.DateTimeFormat("en-CA", { timeZone: window.timeZone })).not.toThrow();
  });
});

describe("enumerateDays", () => {
  it("includes both bounds", () => {
    expect(enumerateDays("2026-09-05", "2026-09-08")).toEqual([
      "2026-09-05",
      "2026-09-06",
      "2026-09-07",
      "2026-09-08",
    ]);
  });

  it("crosses a month boundary", () => {
    expect(enumerateDays("2026-08-30", "2026-09-01")).toEqual([
      "2026-08-30",
      "2026-08-31",
      "2026-09-01",
    ]);
  });

  it("is empty when the bounds are inverted", () => {
    expect(enumerateDays("2026-09-08", "2026-09-05")).toEqual([]);
  });
});

describe("formatters", () => {
  it("compacts tokens to three significant figures", () => {
    expect(formatTokens(0)).toBe("0");
    expect(formatTokens(804_000)).toBe("804K");
    expect(formatTokens(76_700_000)).toBe("76.7M");
    expect(formatTokens(1_234)).toBe("1.23K");
    expect(formatTokens(19_900_000_000)).toBe("19.9B");
    expect(formatTokens(999)).toBe("999");
  });

  it("renders cost, counts, and shares", () => {
    expect(formatUsd(1.5)).toBe("$1.50");
    expect(formatCount(12_345)).toBe("12,345");
    expect(formatPercent(0.4237)).toBe("42.4%");
  });

  it("shortens a day and passes through an unparseable one", () => {
    expect(formatDayShort("2026-08-07")).toBe("Aug 7");
    expect(formatDayShort("not-a-day")).toBe("not-a-day");
  });
});

describe("formatUsdCompact", () => {
  it("compacts thousands and omits unnecessary decimal places for axis ticks", () => {
    expect(formatUsdCompact(0)).toBe("$0");
    expect(formatUsdCompact(600)).toBe("$600");
    expect(formatUsdCompact(1200)).toBe("$1.2K");
    expect(formatUsdCompact(20000)).toBe("$20K");
    expect(formatUsdCompact(2_500_000)).toBe("$2.5M");
  });
});

it("preserves fractional cost ticks instead of repeating rounded labels", () => {
  expect([0.5, 1, 1.5, 2].map((value) => formatUsdCompact(value))).toEqual([
    "$0.5",
    "$1",
    "$1.5",
    "$2",
  ]);
  expect(formatUsdCompact(0.00001)).toBe("$0.00001");
});

describe("period labels", () => {
  it("names the period the column covers", () => {
    expect(formatPeriodShort("2026-09-07", "day")).toBe("Sep 7");
    expect(formatPeriodShort("2026-09-07", "week")).toBe("Sep 7");
    expect(formatPeriodShort("2026-09-01", "month")).toBe("Sep");
    // A week's axis label is its first day, so the readout spells out the rest.
    expect(formatPeriodLong("2026-09-07", "week")).toBe("Sep 7 – Sep 13");
  });
});

describe("msUntilNextLocalDay", () => {
  it("measures to the next local midnight", () => {
    expect(msUntilNextLocalDay(new Date(2026, 8, 14, 23, 59, 0, 0))).toBe(60_000);
    expect(msUntilNextLocalDay(new Date(2026, 8, 14, 0, 0, 0, 0))).toBe(86_400_000);
  });

  it("follows a local day that daylight saving time shortens", () => {
    // New York springs forward on 2026-03-08, a 23-hour day.
    expect(msUntilNextLocalDay(new Date(2026, 2, 8, 0, 0, 0, 0))).toBe(23 * 3_600_000);
  });
});

import { describe, expect, it } from "vitest";
import {
  DEFAULT_SIDEBAR_ROW_ITEMS,
  parseSidebarRowItems,
  resolveHostPair,
  SIDEBAR_ROW_ITEMS,
} from "./row-items";

describe("parseSidebarRowItems", () => {
  it("shows everything by default", () => {
    for (const item of SIDEBAR_ROW_ITEMS) {
      expect(DEFAULT_SIDEBAR_ROW_ITEMS[item]).toBe(true);
    }
  });

  it("applies stored overrides", () => {
    expect(parseSidebarRowItems({ checks: false })).toEqual({
      ...DEFAULT_SIDEBAR_ROW_ITEMS,
      checks: false,
    });
  });

  it("leaves items absent from storage at their default", () => {
    // A newly added item must ship visible rather than inheriting "missing means off".
    expect(parseSidebarRowItems({ host: false })).toEqual({
      ...DEFAULT_SIDEBAR_ROW_ITEMS,
      host: false,
    });
  });

  it("ignores unknown keys and non-boolean values", () => {
    expect(
      parseSidebarRowItems({ checks: "yes", nonsense: false, scripts: null, host: false }),
    ).toEqual({ ...DEFAULT_SIDEBAR_ROW_ITEMS, host: false });
  });

  it.each([[null], [undefined], ["diff"], [42], [["checks"]]])(
    "falls back to defaults for %s",
    (value) => {
      expect(parseSidebarRowItems(value)).toEqual(DEFAULT_SIDEBAR_ROW_ITEMS);
    },
  );

  it("does not hand back the shared default object", () => {
    const parsed = parseSidebarRowItems({ checks: false });
    expect(parsed).not.toBe(DEFAULT_SIDEBAR_ROW_ITEMS);
    expect(DEFAULT_SIDEBAR_ROW_ITEMS.checks).toBe(true);
  });
});

describe("resolveHostPair", () => {
  const on = { rowItems: DEFAULT_SIDEBAR_ROW_ITEMS, alwaysShowHostLabels: false };

  it("leaves the other row items answering only for themselves", () => {
    expect(resolveHostPair({ ...on, alwaysShowHostLabels: true }, "checks")).toEqual({
      rowItems: { ...DEFAULT_SIDEBAR_ROW_ITEMS, checks: false },
      alwaysShowHostLabels: true,
    });
  });

  it("drops the override when the host is switched off", () => {
    expect(resolveHostPair({ ...on, alwaysShowHostLabels: true }, "host")).toEqual({
      rowItems: { ...DEFAULT_SIDEBAR_ROW_ITEMS, host: false },
      alwaysShowHostLabels: false,
    });
  });

  it("keeps the override when the host is switched back on", () => {
    const off = {
      rowItems: { ...DEFAULT_SIDEBAR_ROW_ITEMS, host: false },
      alwaysShowHostLabels: false,
    };
    expect(resolveHostPair(off, "host")).toEqual({
      rowItems: DEFAULT_SIDEBAR_ROW_ITEMS,
      alwaysShowHostLabels: false,
    });
  });

  it("switches the host back on when the override is asked for", () => {
    const off = {
      rowItems: { ...DEFAULT_SIDEBAR_ROW_ITEMS, host: false },
      alwaysShowHostLabels: false,
    };
    expect(resolveHostPair(off, "alwaysShowHostLabels")).toEqual({
      rowItems: DEFAULT_SIDEBAR_ROW_ITEMS,
      alwaysShowHostLabels: true,
    });
  });

  it("leaves the host alone when the override is switched off", () => {
    expect(resolveHostPair({ ...on, alwaysShowHostLabels: true }, "alwaysShowHostLabels")).toEqual({
      rowItems: DEFAULT_SIDEBAR_ROW_ITEMS,
      alwaysShowHostLabels: false,
    });
  });

  it("never mutates the state it is given", () => {
    const current = { rowItems: { ...DEFAULT_SIDEBAR_ROW_ITEMS }, alwaysShowHostLabels: true };
    resolveHostPair(current, "host");
    expect(current.rowItems.host).toBe(true);
    expect(current.alwaysShowHostLabels).toBe(true);
  });
});

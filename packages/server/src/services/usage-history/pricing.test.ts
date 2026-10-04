import { describe, expect, it } from "vitest";
import { cacheSavingsUsd, lookupRate, parseRateTable, priceUsage } from "./pricing.js";

function rate(input: number, cacheRead?: number) {
  return {
    input_cost_per_token: input,
    output_cost_per_token: input * 5,
    ...(cacheRead === undefined ? {} : { cache_read_input_token_cost: cacheRead }),
  };
}

describe("usage pricing", () => {
  const totals = {
    uncachedInputTokens: 1_000_000,
    cachedInputTokens: 1_000_000,
    cacheCreationTokens: 1_000_000,
    outputTokens: 1_000_000,
    reasoningTokens: 500_000,
  };

  it("preserves canonical rates separately from qualified provider rates", () => {
    const canonical = ["claude-fable-5", rate(1e-5, 1e-6)] as const;
    const deepInfra = ["deepinfra/anthropic/claude-fable-5", rate(1e-5)] as const;

    for (const entries of [
      [canonical, deepInfra],
      [deepInfra, canonical],
    ]) {
      const table = parseRateTable(Object.fromEntries(entries));
      expect(lookupRate(table, "claude-fable-5")?.cacheReadCostPerToken).toBe(1e-6);
      expect(lookupRate(table, "deepinfra/anthropic/claude-fable-5")?.cacheReadCostPerToken).toBe(
        1e-5,
      );
      expect(lookupRate(table, "other/claude-fable-5")).toBeNull();
    }
  });

  it("prices bracketed context-tier variants at the base rate", () => {
    const table = parseRateTable({ "claude-fable-5-1": rate(1e-5, 2.5e-7) });
    expect(lookupRate(table, "claude-fable-5-1[1m]")).toEqual(
      lookupRate(table, "claude-fable-5-1"),
    );
    expect(lookupRate(table, "anthropic/Claude-Fable-5-1[1m]")).toBeNull();
  });

  it("adds a bare alias only when every qualified entry has the same rate", () => {
    const unambiguous = parseRateTable({
      "provider-a/example-model": rate(1),
      "provider-b/example-model": rate(1),
    });
    const ambiguous = parseRateTable({
      "provider-a/example-model": rate(1),
      "provider-b/example-model": rate(3),
    });

    expect(lookupRate(unambiguous, "example-model")).toEqual(
      lookupRate(unambiguous, "provider-a/example-model"),
    );
    expect(lookupRate(ambiguous, "example-model")).toBeNull();
  });

  it("leaves ambiguous and synthetic model names unpriced", () => {
    const table = parseRateTable({ "anthropic/opus": rate(1), "example-model": rate(2) });
    expect(lookupRate(table, "opus")).toBeNull();
    expect(lookupRate(table, "<synthetic>")).toBeNull();
    expect(priceUsage(table, "unknown", totals, null)).toEqual({
      costUsd: 0,
      costSource: "unpriced",
    });
  });

  it("uses provider-reported cost before model pricing", () => {
    const table = parseRateTable({ "example-model": rate(1) });
    expect(priceUsage(table, "example-model", totals, 99)).toEqual({
      costUsd: 99,
      costSource: "providerReported",
    });
  });

  it("uses input prices for omitted cache rates and computes cache savings", () => {
    const table = parseRateTable({ "example-model": rate(2e-6, 0.5e-6) });
    expect(priceUsage(table, "example-model", totals, null)).toEqual({
      costUsd: 14.5,
      costSource: "modelPriced",
    });
    expect(cacheSavingsUsd(table, "example-model", totals)).toBe(1.5);
  });
});

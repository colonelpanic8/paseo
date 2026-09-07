/**
 * @vitest-environment jsdom
 */
import { i18n as testI18n } from "@/i18n/i18next";
import React, { type ReactElement } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProviderUsageHistorySection } from "./section";
import type { ProviderUsageHistoryPayload } from "./types";

void testI18n;

const runtime = vi.hoisted(() => ({
  connected: true,
  supported: true,
  client: null as DaemonClient | null,
}));

vi.mock("@/runtime/host-runtime", () => ({
  useHostRuntimeClient: () => runtime.client,
  useHostRuntimeIsConnected: () => runtime.connected,
}));

vi.mock("@/runtime/host-features", () => ({
  useHostFeature: () => runtime.supported,
}));

// The window is computed from wall-clock "now", and the fixture's days have to
// land inside it for the chart to render them.
const NOW = new Date("2026-09-07T18:00:00Z");

const FIXTURE: ProviderUsageHistoryPayload = {
  requestId: "req-1",
  readAt: "2026-09-07T18:00:00.000Z",
  timeZone: "America/New_York",
  sinceDay: "2026-08-09",
  untilDay: "2026-09-07",
  buckets: [
    {
      day: "2026-09-05",
      provider: "claude",
      model: "sonnet-5",
      totals: {
        uncachedInputTokens: 1_000,
        cachedInputTokens: 4_000,
        cacheCreationTokens: 500,
        outputTokens: 2_000,
        reasoningTokens: 800,
      },
      costUsd: 3,
      cacheSavingsUsd: 1,
      costSource: "modelPriced",
      records: 4,
      unpricedRecords: 0,
      sessions: 2,
    },
    {
      day: "2026-09-06",
      provider: "codex",
      model: "gpt-5",
      totals: {
        uncachedInputTokens: 2_000,
        cachedInputTokens: 0,
        cacheCreationTokens: 0,
        outputTokens: 1_000,
        reasoningTokens: 400,
      },
      costUsd: 2,
      cacheSavingsUsd: 0,
      costSource: "providerReported",
      records: 3,
      unpricedRecords: 0,
      sessions: 1,
    },
    {
      day: "2026-09-07",
      provider: "codex",
      model: "gpt-5-codex-preview",
      totals: {
        uncachedInputTokens: 500,
        cachedInputTokens: 0,
        cacheCreationTokens: 0,
        outputTokens: 500,
        reasoningTokens: 0,
      },
      costUsd: 0,
      cacheSavingsUsd: 0,
      costSource: "unpriced",
      records: 1,
      unpricedRecords: 1,
      sessions: 1,
    },
  ],
  sources: [
    {
      provider: "claude",
      path: "/home/dev/.claude",
      status: "ok",
      scannedFiles: 12,
      skippedFiles: 0,
      distinctSessions: 5,
      message: null,
    },
    {
      provider: "codex",
      path: "/home/dev/.codex",
      status: "ok",
      scannedFiles: 8,
      skippedFiles: 0,
      distinctSessions: 3,
      message: null,
    },
  ],
  pricing: {
    status: "cached",
    source: "litellm",
    fetchedAt: "2026-09-07T17:00:00.000Z",
    knownModels: 412,
  },
  scanDurationMs: 240,
};

function createClient() {
  return {
    on: vi.fn(() => () => undefined),
    readProviderUsageHistory: vi.fn(async () => FIXTURE),
  };
}

function renderSection(client: ReturnType<typeof createClient> | null): void {
  runtime.client = client as unknown as DaemonClient | null;
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const element: ReactElement = (
    <QueryClientProvider client={queryClient}>
      <ProviderUsageHistorySection serverId="host-a" />
    </QueryClientProvider>
  );
  render(element);
}

describe("ProviderUsageHistorySection", () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: NOW, shouldAdvanceTime: true });
    vi.stubGlobal("React", React);
    runtime.connected = true;
    runtime.supported = true;
    runtime.client = null;
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("renders the headline, provider rows, and model rows", async () => {
    renderSection(createClient());

    const headline = await screen.findByTestId("usage-history-headline");
    expect(headline.textContent).toBe("$5.00");
    expect(headline.parentElement?.textContent).toContain("8 sessions · API estimate");

    const claude = screen.getByTestId("usage-history-provider-claude").textContent;
    expect(claude).toContain("Claude Code");
    expect(claude).toContain("5 sessions");
    expect(claude).toContain("$3.00");
    expect(claude).toContain("60.0% of cost");

    const codex = screen.getByTestId("usage-history-provider-codex").textContent;
    expect(codex).toContain("Codex");
    expect(codex).toContain("3 sessions");
    expect(codex).toContain("$2.00");

    expect(screen.getByTestId("usage-history-model-sonnet-5").textContent).toContain("$3.00");
    // Priced and unpriced models both get a row; an unpriced one reads $0.00.
    expect(screen.getByTestId("usage-history-model-gpt-5-codex-preview").textContent).toContain(
      "$0.00",
    );

    // Processed tokens exclude reasoning tokens, which are part of output.
    expect(screen.getByText("Processed tokens").parentElement?.textContent).toContain("11.5K");
    expect(screen.getByText("Cached input").parentElement?.textContent).toContain("4K");
  });

  it("shows the empty state and drops the breakdown when the window has no activity", async () => {
    const client = createClient();
    client.readProviderUsageHistory.mockResolvedValue({ ...FIXTURE, buckets: [] });
    renderSection(client);

    expect(await screen.findByText("No activity in this window")).toBeDefined();
    expect(screen.queryByText("Breakdown")).toBeNull();
  });

  it("shows the update prompt when the host does not support the feature", () => {
    runtime.supported = false;
    renderSection(createClient());

    expect(screen.getByText("Update the host to see usage history")).toBeDefined();
  });
});

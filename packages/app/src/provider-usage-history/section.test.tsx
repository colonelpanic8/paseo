/**
 * @vitest-environment jsdom
 */
import { i18n as testI18n } from "@/i18n/i18next";
import React, { type ReactElement } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ProviderUsageHistoryBucket,
  ProviderUsageHistoryPayload,
  ProviderUsageHistorySource,
} from "./types";

void testI18n;

interface FakeHost {
  serverId: string;
  label: string;
  connectionStatus: "online" | "offline";
  supported: boolean;
  /** Where the host is reached, the way the runtime formats it for display. */
  endpoint?: string;
  payload?: ProviderUsageHistoryPayload;
}

const runtime = vi.hoisted(() => ({ hosts: [] as unknown[], isCompact: false }));

function fakeHosts(): FakeHost[] {
  return runtime.hosts as FakeHost[];
}

vi.mock("@/runtime/host-runtime", () => ({
  useHosts: () => fakeHosts().map((host) => ({ serverId: host.serverId, label: host.label })),
  useHostRuntimeConnectionStatuses: (serverIds: readonly string[]) =>
    new Map(
      serverIds.map((serverId) => [
        serverId,
        fakeHosts().find((host) => host.serverId === serverId)?.connectionStatus ?? "offline",
      ]),
    ),
  useHostRuntimeActiveConnectionLabels: (serverIds: readonly string[]) =>
    new Map(
      serverIds.flatMap((serverId) => {
        const endpoint = fakeHosts().find((host) => host.serverId === serverId)?.endpoint;
        return endpoint === undefined ? [] : [[serverId, endpoint] as const];
      }),
    ),
  getHostRuntimeStore: () => ({
    getClient: (serverId: string) => {
      const host = fakeHosts().find((candidate) => candidate.serverId === serverId);
      const hostPayload = host?.payload;
      if (!hostPayload) return null;
      return { readProviderUsageHistory: async () => hostPayload } as unknown as DaemonClient;
    },
  }),
}));

vi.mock("@/constants/layout", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/constants/layout")>()),
  useIsCompactFormFactor: () => runtime.isCompact,
}));

vi.mock("@/runtime/host-features", () => ({
  useHostFeatureMap: (serverIds: readonly string[]) =>
    new Map(
      serverIds.map((serverId) => [
        serverId,
        fakeHosts().find((host) => host.serverId === serverId)?.supported === true,
      ]),
    ),
}));

vi.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));

import { ProviderUsageHistorySection } from "./section";

function source(overrides: Partial<ProviderUsageHistorySource> = {}): ProviderUsageHistorySource {
  return {
    provider: "codex",
    path: "/home/dev/.codex",
    status: "ok",
    scannedFiles: 1,
    skippedFiles: 0,
    distinctSessions: 2,
    message: null,
    ...overrides,
  };
}

function bucket(costUsd: number, unpricedRecords = 0): ProviderUsageHistoryBucket {
  return {
    day: "2026-09-06",
    provider: "codex",
    model: "gpt-5",
    totals: {
      uncachedInputTokens: 0,
      cachedInputTokens: 0,
      cacheCreationTokens: 0,
      outputTokens: 1_000,
      reasoningTokens: 0,
    },
    costUsd,
    cacheSavingsUsd: 0,
    costSource: "modelPriced",
    records: 1,
    unpricedRecords,
    sessions: 1,
  };
}

function payload(
  costUsd: number,
  hostId: string,
  unpricedRecords = 0,
): ProviderUsageHistoryPayload {
  return {
    requestId: "req-1",
    readAt: "2026-09-07T12:00:00.000Z",
    timeZone: "UTC",
    sinceDay: "2026-09-05",
    untilDay: "2026-09-07",
    buckets: [bucket(costUsd, unpricedRecords)],
    sources: [source({ hostId, volumeId: "66306:1" })],
    pricing: { status: "cached", source: "litellm", fetchedAt: null, knownModels: 400 },
    scanDurationMs: 10,
  };
}

function renderSection(hosts: FakeHost[], isCompact = false): void {
  runtime.hosts = hosts;
  runtime.isCompact = isCompact;
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const element: ReactElement = (
    <QueryClientProvider client={queryClient}>
      <ProviderUsageHistorySection />
    </QueryClientProvider>
  );
  render(element);
}

describe("ProviderUsageHistorySection", () => {
  beforeEach(() => {
    vi.stubGlobal("React", React);
    runtime.hosts = [];
    runtime.isCompact = false;
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("sorts daily rows by ordered criteria without changing the chart", async () => {
    const report = payload(3, "test-host");
    report.buckets = [
      { ...bucket(3), day: "2026-09-05", model: "alpha" },
      { ...bucket(1), day: "2026-09-06", model: "alpha" },
      { ...bucket(2), day: "2026-09-06", model: "beta" },
    ];
    renderSection([
      {
        serverId: "host-a",
        label: "test-host",
        connectionStatus: "online",
        supported: true,
        payload: report,
      },
    ]);
    await screen.findByTestId("usage-history-headline");
    const chart = screen.getByTestId("usage-history-chart").innerHTML;
    const rows = () =>
      screen.getAllByTestId("usage-history-breakdown-row").map((row) => row.textContent);
    const choose = (index: number, name: string) =>
      fireEvent.click(
        within(screen.getByTestId(`usage-history-sort-${index}`)).getByRole("button", { name }),
      );
    choose(0, "Day");
    expect(rows()).toHaveLength(3);
    const headings = () =>
      screen
        .getAllByTestId("usage-history-table-group-heading")
        .map((heading) => heading.textContent);
    expect(headings()).toEqual(["2026-09-06", "2026-09-05"]);
    const summaries = () =>
      screen
        .getAllByTestId("usage-history-table-group-summary")
        .map((summary) => summary.textContent);
    expect(summaries()).toEqual(["2026-09-06$3.0050.0%2K", "2026-09-05$3.0050.0%1K"]);
    expect(
      screen
        .getAllByTestId("usage-history-table-group")
        .map((group) => within(group).getAllByTestId("usage-history-breakdown-row").length),
    ).toEqual([2, 1]);
    fireEvent.click(screen.getByRole("button", { name: "Add sort" }));
    choose(1, "Cost");
    expect(rows()[0]).toContain("beta · 2026-09-06");
    expect(rows()[1]).toContain("alpha · 2026-09-06");
    fireEvent.click(screen.getByTestId("usage-history-sort-direction-1"));
    expect(rows()[0]).toContain("alpha · 2026-09-06");
    fireEvent.click(screen.getByTestId("usage-history-sort-direction-0"));
    expect(rows()[0]).toContain("alpha · 2026-09-05");
    expect(headings()).toEqual(["2026-09-05", "2026-09-06"]);
    expect(summaries()).toEqual(["2026-09-05$3.0050.0%1K", "2026-09-06$3.0050.0%2K"]);
    fireEvent.click(
      within(screen.getByTestId("usage-history-sort-row-1")).getByRole("button", {
        name: "Move up",
      }),
    );
    expect(rows()[0]).toContain("alpha · 2026-09-06");
    expect(headings()).toEqual(["$1.00", "$2.00", "$3.00"]);
    fireEvent.click(
      within(screen.getByTestId("usage-history-sort-row-0")).getByRole("button", {
        name: "Remove",
      }),
    );
    expect(rows()[0]).toContain("alpha · 2026-09-05");
    expect(headings()).toEqual(["2026-09-05", "2026-09-06"]);
    expect(screen.getByTestId("usage-history-chart").innerHTML).toBe(chart);
    fireEvent.click(
      within(screen.getByTestId("usage-history-table-metric")).getByRole("button", {
        name: "Tokens",
      }),
    );
    expect(summaries()).toEqual(["2026-09-05$3.0033.3%1K", "2026-09-06$3.0066.7%2K"]);
    const timeGrouping = within(screen.getByTestId("usage-history-time-grouping"));
    fireEvent.click(timeGrouping.getByRole("button", { name: "Week" }));
    expect(headings()).toEqual(["2026-08-31 – 2026-09-06"]);
    expect(rows()).toHaveLength(2);
    expect(summaries()).toEqual(["2026-08-31 – 2026-09-06$6.00100.0%3K"]);
    fireEvent.click(timeGrouping.getByRole("button", { name: "Month" }));
    expect(headings()).toEqual(["2026-09"]);
    expect(summaries()).toEqual(["2026-09$6.00100.0%3K"]);
    fireEvent.click(screen.getByTestId("usage-history-table-group-model"));
    expect(rows()).toHaveLength(1);
    expect(screen.getByTestId("usage-history-chart").innerHTML).toBe(chart);
    const table = screen.getByTestId("usage-history-table").innerHTML;
    fireEvent.click(screen.getByTestId("usage-history-chart-group-model"));
    expect(screen.getByTestId("usage-history-chart").innerHTML).not.toBe(chart);
    expect(screen.getByTestId("usage-history-table").innerHTML).toBe(table);
  });

  it("renders the hosts that answered and names the one that did not", async () => {
    renderSection([
      {
        serverId: "host-a",
        label: "ryzen-shine",
        connectionStatus: "online",
        supported: true,
        payload: payload(3, "ryzen-shine"),
      },
      { serverId: "host-b", label: "jay-lenovo", connectionStatus: "offline", supported: true },
    ]);

    expect((await screen.findByTestId("usage-history-headline")).textContent).toBe("$3.00");
    expect(screen.getByTestId("usage-history-coverage").textContent).toBe("jay-lenovo is offline");
  });

  it("renders one empty card when no selected host is reachable", async () => {
    renderSection([
      { serverId: "host-a", label: "ryzen-shine", connectionStatus: "offline", supported: true },
      { serverId: "host-b", label: "jay-lenovo", connectionStatus: "offline", supported: true },
    ]);

    expect(await screen.findByText("Connect a host to see usage history")).toBeDefined();
    expect(screen.queryByTestId("usage-history-headline")).toBeNull();
  });

  it("combines built-in providers across hosts and splits them when Host is selected", async () => {
    const online = (serverId: string, label: string, cost: number): FakeHost => ({
      serverId,
      label,
      connectionStatus: "online",
      supported: true,
      payload: payload(cost, label),
    });

    renderSection([online("host-a", "ryzen-shine", 3), online("host-b", "jimi-hendnix", 1)]);
    expect((await screen.findByTestId("usage-history-headline")).textContent).toBe("$4.00");
    fireEvent.click(screen.getByTestId("usage-history-table-group-model"));
    fireEvent.click(screen.getByTestId("usage-history-table-group-provider"));
    expect(
      screen.getAllByTestId("usage-history-breakdown-row").map((row) => row.textContent),
    ).toEqual(["Codex$4.00100.0%2K"]);
    fireEvent.click(screen.getByTestId("usage-history-table-group-host"));
    expect(
      screen.getAllByTestId("usage-history-breakdown-row").map((row) => row.textContent),
    ).toEqual(["ryzen-shine · Codex$3.0075.0%1K", "jimi-hendnix · Codex$1.0025.0%1K"]);
  });

  it("selects each line shape without changing usage totals", async () => {
    renderSection([
      {
        serverId: "host-a",
        label: "Laptop",
        connectionStatus: "online",
        supported: true,
        payload: payload(3, "laptop"),
      },
    ]);
    await screen.findByTestId("usage-history-headline");
    const controls = within(screen.getByTestId("usage-history-chart-shape"));
    expect(controls.getByRole("button", { name: "Smooth" }).getAttribute("aria-selected")).toBe(
      "true",
    );
    const figures = screen.getByTestId("usage-history-figures").textContent;
    for (const name of ["Linear", "Step", "Smooth"]) {
      fireEvent.click(controls.getByRole("button", { name }));
      expect(
        controls
          .getAllByRole("button")
          .filter((button) => button.getAttribute("aria-selected") === "true")
          .map((button) => button.textContent),
      ).toEqual([name]);
      expect(screen.getByTestId("usage-history-figures").textContent).toBe(figures);
    }
  });

  it("tells identically named hosts apart by the endpoint each is reached at", async () => {
    renderSection([
      {
        serverId: "host-a",
        label: "ryzen-shine",
        connectionStatus: "online",
        supported: true,
        endpoint: "Local",
        payload: payload(3, "ryzen-shine"),
      },
      {
        serverId: "host-b",
        label: "ryzen-shine",
        connectionStatus: "online",
        supported: true,
        endpoint: "100.64.0.2:6767",
        payload: payload(1, "second-box"),
      },
    ]);

    expect((await screen.findByTestId("usage-history-headline")).textContent).toBe("$4.00");
    expect(screen.getByTestId("usage-history-provider-sub-host-a:codex").textContent).toContain(
      "Codex · ryzen-shine (Local)",
    );
    expect(screen.getByTestId("usage-history-provider-sub-host-b:codex").textContent).toContain(
      "Codex · ryzen-shine (100.64.0.2:6767)",
    );
  });

  it("qualifies a colliding name in the coverage line too", async () => {
    renderSection([
      {
        serverId: "host-a",
        label: "ryzen-shine",
        connectionStatus: "online",
        supported: true,
        endpoint: "Local",
        payload: payload(3, "ryzen-shine"),
      },
      {
        serverId: "host-b",
        label: "ryzen-shine",
        connectionStatus: "offline",
        supported: true,
        endpoint: "100.64.0.2:6767",
      },
    ]);

    await screen.findByTestId("usage-history-headline");
    expect(screen.getByTestId("usage-history-coverage").textContent).toBe(
      "ryzen-shine (100.64.0.2:6767) is offline",
    );
  });

  it("leaves a host that is the only one of its name unqualified", async () => {
    renderSection([
      {
        serverId: "host-a",
        label: "ryzen-shine",
        connectionStatus: "online",
        supported: true,
        endpoint: "Local",
        payload: payload(3, "ryzen-shine"),
      },
      {
        serverId: "host-b",
        label: "jay-lenovo",
        connectionStatus: "offline",
        supported: true,
        endpoint: "100.64.0.2:6767",
      },
    ]);

    await screen.findByTestId("usage-history-headline");
    expect(screen.getByTestId("usage-history-coverage").textContent).toBe("jay-lenovo is offline");
  });

  it("carries the unpriced caveat as one footnote rather than on every figure", async () => {
    renderSection([
      {
        serverId: "host-a",
        label: "ryzen-shine",
        connectionStatus: "online",
        supported: true,
        payload: payload(3, "ryzen-shine", 4),
      },
    ]);

    expect((await screen.findByTestId("usage-history-headline")).textContent).toBe("$3.00");
    expect(screen.getAllByTestId("usage-history-unpriced")).toHaveLength(1);
    expect(screen.getByTestId("usage-history-unpriced").textContent).toBe(
      "Estimate excludes 4 responses with no known price",
    );
  });

  it("keeps the figures and the chart in both the two-column and the stacked layout", async () => {
    const host: FakeHost = {
      serverId: "host-a",
      label: "ryzen-shine",
      connectionStatus: "online",
      supported: true,
      payload: payload(3, "ryzen-shine"),
    };

    renderSection([host]);
    await screen.findByTestId("usage-history-headline");
    expect(screen.getByTestId("usage-history-figures")).toBeDefined();
    expect(screen.getByTestId("usage-history-chart")).toBeDefined();
    cleanup();

    renderSection([host], true);
    await screen.findByTestId("usage-history-headline");
    expect(screen.getByTestId("usage-history-figures")).toBeDefined();
    expect(screen.getByTestId("usage-history-chart")).toBeDefined();
  });
});

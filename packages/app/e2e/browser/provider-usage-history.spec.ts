import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test as base } from "../support/fixtures";
import { gotoAppShell, openSettings } from "../support/helpers/app";

const test = base.extend<{}, { transcriptHome: string }>({
  transcriptHome: [
    async ({ browserName }, provide) => {
      const home = await mkdtemp(path.join(tmpdir(), `paseo-usage-history-${browserName}-`));
      try {
        await provide(home);
      } finally {
        await rm(home, { recursive: true, force: true });
      }
    },
    { scope: "worker" },
  ],
  e2eDaemonEnvironment: [
    async ({ transcriptHome }, provide) => {
      await provide({
        CLAUDE_CONFIG_DIR: path.join(transcriptHome, "claude"),
        CODEX_HOME: path.join(transcriptHome, "codex"),
      });
    },
    { scope: "worker" },
  ],
  // Two extra Codex homes, the way a user runs a second account: extend the
  // built-in provider and give it its own CODEX_HOME.
  e2eDaemonConfig: [
    async ({ transcriptHome }, provide) => {
      await provide({
        version: 1,
        agents: {
          providers: {
            "codex-ben": {
              extends: "codex",
              label: "Codex (Ben)",
              env: { CODEX_HOME: path.join(transcriptHome, "codex-ben") },
            },
            "codex-colonel": {
              extends: "codex",
              label: "Codex (Colonel)",
              env: { CODEX_HOME: path.join(transcriptHome, "codex-colonel") },
            },
          },
        },
      });
    },
    { scope: "worker" },
  ],
});

test("shows the unpriced footnote from real transcripts and refreshes to an empty window", async ({
  page,
  transcriptHome,
}, testInfo) => {
  test.setTimeout(120_000);
  const paseoHome = process.env.E2E_PASEO_HOME;
  if (!paseoHome) throw new Error("Missing isolated daemon home");
  const ratesDir = path.join(paseoHome, "usage-history");
  await mkdir(ratesDir, { recursive: true });
  await writeFile(
    path.join(ratesDir, "model-rates.json"),
    JSON.stringify({
      fetchedAtMs: Date.now(),
      document: {
        "usage-test-known": { input_cost_per_token: 0.00001, output_cost_per_token: 0.00005 },
      },
    }),
  );
  const dir = path.join(transcriptHome, "claude", "projects", "test");
  await mkdir(dir, { recursive: true });
  const transcript = path.join(dir, "session.jsonl");
  const rows = [0, 1, 2].map((id) => ({
    type: "assistant",
    timestamp: new Date().toISOString(),
    sessionId: "usage-test-session",
    requestId: `req_${id}`,
    costUSD: id === 0 ? 2 : undefined,
    message: {
      id: `msg_${id}`,
      model: id === 2 ? "usage-test-unpriced" : "usage-test-partial",
      usage: { input_tokens: 100, output_tokens: 200 },
    },
  }));
  await writeFile(transcript, rows.map((row) => JSON.stringify(row)).join("\n") + "\n");

  await page.setViewportSize({ width: 1280, height: 1000 });
  await gotoAppShell(page);
  await openSettings(page);
  await page.getByTestId("settings-section-usage-history").click();
  await expect(page.getByTestId("usage-history-headline")).toHaveText("$2.00");
  const chart = page.getByTestId("usage-history-chart");
  const chartBounds = await chart.boundingBox();
  expect(chartBounds?.width).toBeGreaterThan(720);
  expect(chartBounds?.height).toBeGreaterThan(450);

  await expect(page.getByTestId("usage-history-unpriced")).toBeVisible();
  const tableRows = page.getByTestId("usage-history-breakdown-row");
  await expect(tableRows.filter({ hasText: "usage-test-partial" })).toContainText("$2.00");
  await expect(tableRows.filter({ hasText: "usage-test-unpriced" })).toContainText("$0.00");
  await page.screenshot({ path: testInfo.outputPath("incomplete-costs.png"), fullPage: true });
  await page
    .getByTestId("usage-history-metric")
    .getByRole("button", { name: "Tokens", exact: true })
    .click();
  await expect(page.getByTestId("usage-history-headline")).toHaveText("900");
  await page.getByRole("button", { name: "90d", exact: true }).click();
  await expect(page.getByTestId("usage-history-headline")).toHaveText("900");
  await page.setViewportSize({ width: 420, height: 900 });
  await page.getByRole("button", { name: "90d", exact: true }).click();
  await expect(page.getByTestId("usage-history-headline")).toHaveText("$2.00");
  await page.screenshot({
    path: testInfo.outputPath("incomplete-costs-compact.png"),
    fullPage: true,
  });
  await rm(transcript);
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(page.getByText("No activity in this window", { exact: true })).toBeVisible();
});

const BEN_LABEL = "Codex (Ben)";
const COLONEL_LABEL = "Codex (Colonel)";

/** One rollout with a single priced turn, written to `<home>/sessions`. */
async function writeCodexRollout(home: string, session: string, outputTokens: number) {
  const dir = path.join(home, "sessions", "2026", "01", "01");
  await mkdir(dir, { recursive: true });
  const timestamp = new Date().toISOString();
  const rows = [
    { type: "session_meta", timestamp, payload: { id: session } },
    { type: "turn_context", timestamp, payload: { model: "usage-test-known" } },
    {
      type: "event_msg",
      timestamp,
      payload: {
        type: "token_count",
        info: { last_token_usage: { input_tokens: 100, output_tokens: outputTokens } },
      },
    },
  ];
  await writeFile(
    path.join(dir, `${session}.jsonl`),
    rows.map((row) => JSON.stringify(row)).join("\n") + "\n",
  );
}

test.describe("multiple configured providers of one kind", () => {
  test.use({ deviceScaleFactor: 2 });

  test("combines breakdown dimensions and sorts the resulting rows", async ({
    page,
    transcriptHome,
  }, testInfo) => {
    test.setTimeout(120_000);
    // The default Codex home plus two extra ones: only a kind with more than one
    // active provider earns sub-rows, so Claude stays a single row as the control.
    await writeCodexRollout(path.join(transcriptHome, "codex"), "codex-default", 200);
    await writeCodexRollout(path.join(transcriptHome, "codex-ben"), "codex-ben", 400);
    await writeCodexRollout(path.join(transcriptHome, "codex-colonel"), "codex-colonel", 800);
    const claudeDir = path.join(transcriptHome, "claude", "projects", "multi");
    await mkdir(claudeDir, { recursive: true });
    await writeFile(
      path.join(claudeDir, "session.jsonl"),
      JSON.stringify({
        type: "assistant",
        timestamp: new Date().toISOString(),
        sessionId: "claude-only",
        requestId: "req_multi",
        message: {
          id: "msg_multi",
          model: "usage-test-known",
          usage: { input_tokens: 100, output_tokens: 100 },
        },
      }) + "\n",
    );

    await page.setViewportSize({ width: 1280, height: 1100 });
    await gotoAppShell(page);
    await openSettings(page);
    await page.getByTestId("settings-section-usage-history").click();

    // Codex splits; Claude has one configured provider and must not.
    await expect(page.getByTestId("usage-history-provider-sub-codex")).toBeVisible();
    await expect(page.getByTestId("usage-history-provider-sub-codex-ben")).toContainText(BEN_LABEL);
    await expect(page.getByTestId("usage-history-provider-sub-codex-colonel")).toContainText(
      COLONEL_LABEL,
    );
    await expect(page.getByTestId("usage-history-provider-sub-claude")).toHaveCount(0);
    // Sub-rows split the kind rather than adding to it: the three homes cost
    // $0.04 + $0.02 + $0.01 and the Codex row above them reads $0.07.
    await expect(page.getByTestId("usage-history-provider-sub-codex-colonel")).toContainText(
      "$0.04",
    );
    await expect(page.getByTestId("usage-history-provider-sub-codex-ben")).toContainText("$0.02");
    await expect(page.getByTestId("usage-history-provider-sub-codex")).toContainText("$0.01");
    await expect(page.getByTestId("usage-history-provider-codex")).toContainText("$0.07");
    await page.screenshot({ path: testInfo.outputPath("provider-sub-rows.png"), fullPage: true });

    const rows = page.getByTestId("usage-history-breakdown-row");
    await expect(rows).toHaveCount(1);
    const chartLines = page.getByTestId("usage-history-chart").locator('svg path[fill="none"]');
    await expect(chartLines).toHaveCount(1);

    await page.getByTestId("usage-history-group-provider").click();
    await expect(rows).toHaveCount(4);
    await expect(chartLines).toHaveCount(4);
    await page.screenshot({
      path: testInfo.outputPath("combined-provider-model.png"),
      fullPage: true,
    });

    await expect(rows.filter({ hasText: COLONEL_LABEL })).toContainText("usage-test-known");
    await expect(rows.first()).toContainText(COLONEL_LABEL);
    await page.getByTestId("usage-history-group-day").click();
    await expect(rows).toHaveCount(4);
    await expect(rows.first()).toContainText(new Date().getFullYear().toString());
    await page.getByTestId("usage-history-sort-direction").click();
    await expect(rows.first()).toContainText("Claude Code");
    await page
      .getByTestId("usage-history-sort")
      .getByRole("button", { name: "Group", exact: true })
      .click();
    await expect(rows.first()).toContainText("Claude Code");
    await page
      .getByTestId("usage-history-sort")
      .getByRole("button", { name: "Tokens", exact: true })
      .click();
    await expect(rows.first()).toContainText("Claude Code");
    await page.getByTestId("usage-history-group-model").click();
    await page.getByTestId("usage-history-group-provider").click();
    await page.getByTestId("usage-history-group-day").click();
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText("Total");
    await page.getByTestId("usage-history-group-provider").click();
    await expect(rows).toHaveCount(4);
    await page.screenshot({
      path: testInfo.outputPath("provider-breakdown.png"),
      fullPage: true,
    });
  });
});

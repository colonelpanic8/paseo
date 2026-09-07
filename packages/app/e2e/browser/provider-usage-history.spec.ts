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
});

test("shows incomplete costs from real transcripts and refreshes to an empty window", async ({
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
  await page.getByTestId("settings-host-section-usage-history").click();
  await expect(page.getByTestId("usage-history-headline")).toHaveText("≥$2.00");
  await expect(page.getByText(/Some activity has no price/)).toBeVisible();
  await expect(page.getByTestId("usage-history-model-usage-test-partial")).toContainText("≥$2.00");
  await expect(page.getByTestId("usage-history-model-usage-test-unpriced")).toContainText("—");
  await expect(page.getByTestId("usage-history-model-usage-test-unpriced")).not.toContainText(
    "$0.00",
  );
  await page.screenshot({ path: testInfo.outputPath("incomplete-costs.png"), fullPage: true });
  await page.getByRole("button", { name: "Tokens", exact: true }).click();
  await expect(page.getByTestId("usage-history-headline")).toHaveText("900");
  await page.getByRole("button", { name: "90d", exact: true }).click();
  await expect(page.getByTestId("usage-history-headline")).toHaveText("900");
  await page.setViewportSize({ width: 420, height: 900 });
  await page.getByRole("button", { name: "90d", exact: true }).click();
  await expect(page.getByTestId("usage-history-headline")).toHaveText("≥$2.00");
  await page.screenshot({
    path: testInfo.outputPath("incomplete-costs-compact.png"),
    fullPage: true,
  });
  await rm(transcript);
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(page.getByText("No activity in this window", { exact: true })).toBeVisible();
});

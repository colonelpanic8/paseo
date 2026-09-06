import { rm } from "node:fs/promises";
import { z } from "zod";
import { test, expect, type Page } from "../support/fixtures";
import { gotoAppShell } from "../support/helpers/app";
import { daemonWsRoutePattern } from "../support/helpers/daemon-port";
import { seedWorkspace } from "../support/helpers/seed-client";

async function openCleanup(page: Page) {
  await expect(page.getByTestId("sidebar-search")).toBeVisible({ timeout: 30_000 });
  await page.keyboard.press("ControlOrMeta+K");
  const panel = page.getByTestId("command-center-panel");
  await expect(panel).toBeVisible();
  await panel.getByTestId("command-center-input").fill("purge");
  await panel.getByRole("button", { name: "Clean up missing workspaces", exact: true }).click();
  const sheet = page.getByTestId("workspace-pruning-sheet");
  await expect(sheet).toBeVisible();
  return sheet;
}

async function rejectNextCleanup(page: Page) {
  let rejectNext = true;
  const { promise: rejection, resolve } = Promise.withResolvers<() => void>();
  await page.routeWebSocket(daemonWsRoutePattern(), (browser) => {
    const server = browser.connectToServer();
    browser.onMessage((message) => {
      if (typeof message !== "string") {
        server.send(message);
        return;
      }
      const parsed = z
        .object({
          type: z.literal("session"),
          message: z.object({
            type: z.literal("workspace.prune.request"),
            requestId: z.string(),
            dryRun: z.boolean().optional(),
          }),
        })
        .safeParse(JSON.parse(message));
      if (parsed.success && !parsed.data.message.dryRun && rejectNext) {
        rejectNext = false;
        resolve(() =>
          browser.send(
            JSON.stringify({
              type: "session",
              message: {
                type: "workspace.prune.response",
                payload: {
                  requestId: parsed.data.message.requestId,
                  dryRun: false,
                  workspaces: [],
                  errors: [],
                  error: "Cleanup temporarily unavailable",
                },
              },
            }),
          ),
        );
        return;
      }
      server.send(message);
    });
    server.onMessage((message) => browser.send(message));
  });
  return { rejection };
}

test("previews and archives missing folders from Control+K", async ({ page }, testInfo) => {
  const missing = await seedWorkspace({ repoPrefix: "cc-prune-missing-", git: false });
  const present = await seedWorkspace({ repoPrefix: "cc-prune-present-", git: false });
  try {
    await gotoAppShell(page);
    await rm(missing.workspaceDirectory, { recursive: true });
    const sheet = await openCleanup(page);
    await expect(sheet.getByTestId("workspace-pruning-summary")).toHaveText(
      "Missing workspaces: 1",
    );
    await expect(sheet.getByText(missing.workspaceDirectory, { exact: true })).toBeVisible();
    expect((await missing.client.fetchWorkspaces()).entries.map((entry) => entry.id)).toContain(
      missing.workspaceId,
    );
    const previewPath = testInfo.outputPath("cleanup-preview.png");
    await sheet.screenshot({ path: previewPath });
    await testInfo.attach("cleanup-preview", { path: previewPath, contentType: "image/png" });

    await sheet.getByTestId("workspace-pruning-archive").click();
    await expect(sheet.getByTestId("workspace-pruning-summary")).toHaveText(
      "Archived workspaces: 1",
    );
    expect((await present.client.fetchWorkspaces()).entries.map((entry) => entry.id)).toEqual([
      present.workspaceId,
    ]);
    const resultPath = testInfo.outputPath("cleanup-result.png");
    await sheet.screenshot({ path: resultPath });
    await testInfo.attach("cleanup-result", { path: resultPath, contentType: "image/png" });
    await sheet.getByTestId("workspace-pruning-close").click();
    await openCleanup(page);
    await expect(page.getByTestId("workspace-pruning-summary")).toHaveText("Missing workspaces: 0");
    await expect(page.getByTestId("workspace-pruning-archive")).toHaveCount(0);
  } finally {
    await missing.cleanup();
    await present.cleanup();
  }
});

test("shows pending and failure states and lets the user retry cleanup", async ({ page }) => {
  const missing = await seedWorkspace({ repoPrefix: "cc-prune-retry-", git: false });
  const { rejection } = await rejectNextCleanup(page);
  try {
    await gotoAppShell(page);
    await rm(missing.workspaceDirectory, { recursive: true });
    const sheet = await openCleanup(page);
    const archive = sheet.getByTestId("workspace-pruning-archive");
    await archive.click();
    const reject = await rejection;
    await expect(sheet.getByTestId("workspace-pruning-pending")).toHaveText(
      "Archiving missing workspaces…",
    );
    await expect(archive).toBeDisabled();
    reject();
    await expect(sheet.getByTestId("workspace-pruning-error")).toHaveText(
      "Cleanup temporarily unavailable",
    );
    await expect(archive).toHaveText("Retry");
    expect((await missing.client.fetchWorkspaces()).entries.map((entry) => entry.id)).toContain(
      missing.workspaceId,
    );
    await archive.click();
    await expect(sheet.getByTestId("workspace-pruning-summary")).toHaveText(
      "Archived workspaces: 1",
    );
    await expect(sheet.getByTestId("workspace-pruning-error")).toHaveCount(0);
  } finally {
    await missing.cleanup();
  }
});

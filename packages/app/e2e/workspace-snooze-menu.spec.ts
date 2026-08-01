import { mkdir } from "node:fs/promises";
import path from "node:path";
import { expect, test, type Page } from "./fixtures";
import { gotoAppShell } from "./helpers/app";
import { seedWorkspace, type SeededWorkspace } from "./helpers/seed-client";
import { getServerId } from "./helpers/server-id";

const DESKTOP_VIEWPORT = { width: 1440, height: 960 };
const SCREENSHOT_SETTLE_DELAY_MS = 600;

async function captureScreenshot(page: Page, filename: string): Promise<void> {
  const screenshotDirectory = process.env.PASEO_SNOOZE_SCREENSHOT_DIR;
  if (!screenshotDirectory) {
    return;
  }
  await page.waitForTimeout(SCREENSHOT_SETTLE_DELAY_MS);
  await mkdir(screenshotDirectory, { recursive: true });
  await page.screenshot({
    path: path.join(screenshotDirectory, filename),
    animations: "disabled",
  });
}

function workspaceKey(workspaceId: string): string {
  return `${getServerId()}:${workspaceId}`;
}

function workspaceRow(page: Page, workspaceId: string) {
  return page.getByTestId(`sidebar-workspace-row-${workspaceKey(workspaceId)}`);
}

// The kebab is hover-revealed on desktop, so the row is hovered first.
async function openWorkspaceMenu(page: Page, workspaceId: string) {
  const row = workspaceRow(page, workspaceId);
  await expect(row).toBeVisible({ timeout: 30_000 });
  await row.hover();
  const kebab = page.getByTestId(`sidebar-workspace-kebab-${workspaceKey(workspaceId)}`);
  await expect(kebab).toBeVisible({ timeout: 10_000 });
  await kebab.click();
}

async function fetchWorkspaceSnoozeStatus(
  session: SeededWorkspace,
): Promise<{ snoozedAt: string; snoozedUntil: string } | null> {
  const workspaces = await session.client.fetchWorkspaces({
    filter: { projectId: session.projectId },
  });
  for (const entry of workspaces.entries) {
    if (entry.id === session.workspaceId) {
      return entry.snoozeStatus ?? null;
    }
  }
  return null;
}

async function switchToStatusGrouping(page: Page): Promise<void> {
  await page.getByTestId("sidebar-display-preferences-menu").click();
  await page.getByTestId("sidebar-grouping-status").click();
  await expect(page.getByTestId("sidebar-status-list-scroll")).toBeVisible({ timeout: 10_000 });
}

test.describe("workspace snooze menu", () => {
  test("snoozes and wakes a workspace from the sidebar row menu", async ({ page }) => {
    await page.setViewportSize(DESKTOP_VIEWPORT);
    const session = await seedWorkspace({ repoPrefix: "workspace-snooze-menu-" });

    try {
      await gotoAppShell(page);

      await openWorkspaceMenu(page, session.workspaceId);
      const key = workspaceKey(session.workspaceId);
      await expect(page.getByTestId(`sidebar-workspace-menu-snooze-hour-${key}`)).toBeVisible();
      await expect(page.getByText("Snooze for 1 hour", { exact: true })).toBeVisible();
      await expect(page.getByText("Snooze until tomorrow", { exact: true })).toBeVisible();
      const customSnooze = page.getByTestId(`sidebar-workspace-menu-snooze-custom-${key}`);
      await expect(customSnooze).toBeVisible();
      await captureScreenshot(page, "sidebar-snooze-menu.png");
      await customSnooze.click();

      const customSheet = page.getByTestId("workspace-custom-snooze-sheet");
      await expect(customSheet).toBeVisible();
      const dateTimeInput = page.getByTestId("workspace-custom-snooze-datetime-input");
      await expect(dateTimeInput).toBeVisible();
      await expect(dateTimeInput).toHaveAttribute("type", "datetime-local");
      await captureScreenshot(page, "sidebar-custom-snooze.png");
      await page.getByTestId("workspace-custom-snooze-submit").click();
      await expect(customSheet).not.toBeVisible({ timeout: 30_000 });
      await expect.poll(() => fetchWorkspaceSnoozeStatus(session)).not.toBeNull();

      // The snoozed workspace's menu offers Wake instead of the presets.
      await openWorkspaceMenu(page, session.workspaceId);
      const wake = page.getByTestId(`sidebar-workspace-menu-wake-${key}`);
      await expect(wake).toBeVisible({ timeout: 10_000 });
      await expect(page.getByTestId(`sidebar-workspace-menu-snooze-hour-${key}`)).toHaveCount(0);
      await wake.click();
      await expect.poll(() => fetchWorkspaceSnoozeStatus(session)).toBeNull();
    } finally {
      await session.cleanup();
    }
  });

  test("shows a snoozed workspace in the collapsed-by-default Snoozed status group", async ({
    page,
  }) => {
    await page.setViewportSize(DESKTOP_VIEWPORT);
    const session = await seedWorkspace({ repoPrefix: "workspace-snooze-group-" });

    try {
      const snoozedUntil = new Date(Date.now() + 60 * 60 * 1000).toISOString();
      await session.client.setWorkspaceSnooze(session.workspaceId, snoozedUntil);

      await gotoAppShell(page);
      await switchToStatusGrouping(page);

      const groupHeader = page.getByTestId("sidebar-status-group-snoozed");
      await expect(groupHeader).toBeVisible({ timeout: 30_000 });
      // Collapsed by default: the row only appears after expanding the group.
      await expect(workspaceRow(page, session.workspaceId)).toHaveCount(0);
      await groupHeader.click();
      await expect(workspaceRow(page, session.workspaceId)).toBeVisible({ timeout: 10_000 });
      await captureScreenshot(page, "sidebar-snoozed-group.png");
    } finally {
      await session.cleanup();
    }
  });
});

import { mkdir } from "node:fs/promises";
import path from "node:path";
import { expect, test, type Page } from "./fixtures";
import {
  openAgentRoute,
  seedMockAgentWorkspace,
  type MockAgentWorkspace,
} from "./helpers/mock-agent";

const MOBILE_VIEWPORT = { width: 390, height: 844 };
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

async function fetchAgentSnoozeStatus(session: MockAgentWorkspace): Promise<string | null> {
  const agents = await session.client.fetchAgents({ scope: "active" });
  for (const entry of agents.entries) {
    if (entry.agent.id === session.agentId) {
      return entry.agent.snoozeStatus?.status ?? null;
    }
  }
  return null;
}

test.describe("agent snooze menu", () => {
  test("is available from the desktop tab context menu", async ({ page }) => {
    await page.setViewportSize(DESKTOP_VIEWPORT);
    const session = await seedMockAgentWorkspace({
      repoPrefix: "snooze-menu-desktop-",
      title: "Research API migration",
      initialPrompt: "Review the API migration plan.",
    });

    try {
      await openAgentRoute(page, session);
      const tab = page.getByTestId(`workspace-tab-agent_${session.agentId}`);
      await expect(tab).toBeVisible({ timeout: 30_000 });
      await tab.click({ button: "right" });

      const menu = page.getByTestId(`workspace-tab-context-agent_${session.agentId}`);
      await expect(menu).toBeVisible();
      await expect(menu.getByText("Snooze for 1 hour", { exact: true })).toBeVisible();
      await expect(menu.getByText("Snooze until tomorrow", { exact: true })).toBeVisible();
      const customSnooze = menu.getByText("Custom snooze…", { exact: true });
      await expect(customSnooze).toBeVisible();
      await captureScreenshot(page, "desktop-snooze-menu.png");
      await customSnooze.click();

      const customSheet = page.getByTestId("agent-custom-snooze-sheet");
      await expect(customSheet).toBeVisible();
      const dateTimeInput = page.getByTestId("agent-custom-snooze-datetime-input");
      await expect(dateTimeInput).toBeVisible();
      await expect(dateTimeInput).toHaveAttribute("type", "datetime-local");
      await captureScreenshot(page, "desktop-custom-snooze.png");
      await page.getByTestId("agent-custom-snooze-submit").click();
      await expect(customSheet).not.toBeVisible({ timeout: 30_000 });
      await expect.poll(() => fetchAgentSnoozeStatus(session)).toBe("snoozed");
    } finally {
      await session.cleanup();
    }
  });

  test("is available from the mobile tab ellipsis menu", async ({ page }) => {
    await page.setViewportSize(MOBILE_VIEWPORT);
    const session = await seedMockAgentWorkspace({
      repoPrefix: "snooze-menu-mobile-",
      title: "Research API migration",
      initialPrompt: "Review the API migration plan.",
    });

    try {
      await openAgentRoute(page, session);
      await page.getByTestId("workspace-tab-switcher-trigger").click();

      const menuBase = `workspace-tab-menu-agent_${session.agentId}`;
      const menuTrigger = page.getByTestId(`${menuBase}-trigger`);
      await expect(menuTrigger).toBeVisible({ timeout: 30_000 });
      await menuTrigger.click();

      const menu = page.getByTestId(menuBase);
      await expect(menu).toBeVisible();
      await expect(menu.getByText("Snooze for 1 hour", { exact: true })).toBeVisible();
      await expect(menu.getByText("Snooze until tomorrow", { exact: true })).toBeVisible();
      const customSnooze = menu.getByText("Custom snooze…", { exact: true });
      await expect(customSnooze).toBeVisible();
      await captureScreenshot(page, "mobile-snooze-menu.png");
      await customSnooze.click();

      await expect(page.getByTestId("agent-custom-snooze-sheet")).toBeVisible();
      const dateTimeInput = page.getByTestId("agent-custom-snooze-datetime-input");
      await expect(dateTimeInput).toBeVisible();
      await expect(dateTimeInput).toHaveAttribute("type", "datetime-local");
      await captureScreenshot(page, "mobile-custom-snooze.png");
    } finally {
      await session.cleanup();
    }
  });
});

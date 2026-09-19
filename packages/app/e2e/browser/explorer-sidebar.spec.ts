import type { Page } from "@playwright/test";
import { expect, test } from "../support/fixtures";
import { runWorkspaceActionFromCommandCenter } from "../support/helpers/command-center-workspace-actions";
import {
  installComponentRenderCounter,
  readComponentRenders,
  resetComponentRenders,
} from "../support/helpers/component-renders";
import { gotoWorkspace } from "../support/helpers/launcher";
import { seedWorkspace } from "../support/helpers/seed-client";
import {
  ensureExplorerSidebar,
  openFilesPanel,
  waitForWorkspaceTabsVisible,
} from "../support/helpers/workspace-tabs";

const RESIZE_DRAG_STEPS = 20;
const RESIZE_DRAG_STEP_PX = 5;
const SPLIT_TREE_COMPONENTS = [
  "SplitContainer",
  "SplitNodeViewContent",
  "SplitPaneView",
  "RetainedPanel",
  "WorkspaceDesktopTabsRow",
  "WorkspacePanelHost",
  "ExplorerSidebarDock",
  "ResizeHandle",
] as const;

function explorerSidebar(page: Parameters<typeof ensureExplorerSidebar>[0]) {
  return page.getByTestId("workspace-explorer-sidebar").filter({ visible: true });
}

async function explorerSidebarWidth(page: Page): Promise<number> {
  const bounds = await explorerSidebar(page).boundingBox();
  if (!bounds) throw new Error("Explorer sidebar has no bounds");
  return bounds.width;
}

/** Counts rewrites of the Unistyles web stylesheet, which regenerates its whole text per new style. */
async function observeUnistylesStylesheet(page: Page): Promise<void> {
  await page.evaluate(() => {
    const styleTag = document.getElementById("unistyles-web");
    if (!styleTag) throw new Error("Unistyles web stylesheet is missing");
    Reflect.set(globalThis, "__E2E_UNISTYLES_REWRITES__", 0);
    const observer = new MutationObserver((records) => {
      const count = Reflect.get(globalThis, "__E2E_UNISTYLES_REWRITES__");
      Reflect.set(globalThis, "__E2E_UNISTYLES_REWRITES__", Number(count) + records.length);
    });
    observer.observe(styleTag, { childList: true, characterData: true, subtree: true });
  });
}

async function readUnistylesStylesheetRewrites(page: Page): Promise<number> {
  return await page.evaluate(() => Number(Reflect.get(globalThis, "__E2E_UNISTYLES_REWRITES__")));
}

async function nextFrame(page: Page): Promise<void> {
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
}

test.describe("Explorer sidebar", () => {
  test("starts with Files and Changes, switches views, and toggles without changing main", async ({
    page,
  }) => {
    const workspace = await seedWorkspace({ repoPrefix: "explorer-sidebar-defaults-" });

    try {
      await gotoWorkspace(page, workspace.workspaceId);
      await waitForWorkspaceTabsVisible(page);
      const mainTabsBefore = await page
        .getByTestId("workspace-pane-main")
        .locator('[data-testid^="workspace-tab-"]')
        .count();

      const explorer = await ensureExplorerSidebar(page);
      await expect(explorer.getByTestId("explorer-sidebar-tab-files")).toBeVisible();
      await expect(explorer.getByTestId("explorer-sidebar-tab-changes_tree")).toBeVisible();
      await expect(explorer.getByTestId("workspace-new-tab-button")).toHaveCount(0);

      await openFilesPanel(page);
      await expect(explorer.getByTestId("file-explorer-tree-scroll")).toBeVisible();

      await explorer.getByTestId("explorer-sidebar-tab-changes_tree").click();
      await expect(explorer.getByTestId("changes-tree-panel")).toBeVisible();

      await page.getByTestId("workspace-explorer-toggle").first().click();
      await expect(explorerSidebar(page)).toHaveCount(0);
      await expect(
        page.getByTestId("workspace-pane-main").locator('[data-testid^="workspace-tab-"]'),
      ).toHaveCount(mainTabsBefore);
    } finally {
      await workspace.cleanup();
    }
  });

  test("dragging the resize handle resizes the dock without re-rendering workspace panes", async ({
    page,
  }, testInfo) => {
    await installComponentRenderCounter(page);
    const workspace = await seedWorkspace({ repoPrefix: "explorer-sidebar-resize-" });

    try {
      await gotoWorkspace(page, workspace.workspaceId);
      await waitForWorkspaceTabsVisible(page);
      await runWorkspaceActionFromCommandCenter(page, "Split pane right");
      await runWorkspaceActionFromCommandCenter(page, "Split pane right");
      const panes = page.locator('[data-testid^="workspace-pane-"]').filter({ visible: true });
      await expect(panes).toHaveCount(3);
      await ensureExplorerSidebar(page);

      const handle = page
        .getByTestId("workspace-explorer-sidebar-resize-handle")
        .getByRole("separator");
      const handleBounds = await handle.boundingBox();
      if (!handleBounds) throw new Error("Explorer sidebar resize handle has no bounds");
      const startX = handleBounds.x + handleBounds.width / 2;
      const y = handleBounds.y + 120;
      const widthBefore = await explorerSidebarWidth(page);

      await page.mouse.move(startX, y);
      await page.mouse.down();
      await nextFrame(page);
      await resetComponentRenders(page);
      await observeUnistylesStylesheet(page);
      for (let step = 1; step <= RESIZE_DRAG_STEPS; step += 1) {
        await page.mouse.move(startX - step * RESIZE_DRAG_STEP_PX, y);
      }
      await nextFrame(page);
      const dragRenders = await readComponentRenders(page, SPLIT_TREE_COMPONENTS);
      const dragStylesheetRewrites = await readUnistylesStylesheetRewrites(page);
      const widthDuringDrag = await explorerSidebarWidth(page);

      await resetComponentRenders(page);
      await page.mouse.up();
      await nextFrame(page);
      const releaseRenders = await readComponentRenders(page, SPLIT_TREE_COMPONENTS);
      const widthAfterRelease = await explorerSidebarWidth(page);

      const report = {
        panes: await panes.count(),
        pointerMoves: RESIZE_DRAG_STEPS,
        widthBefore,
        widthDuringDrag,
        widthAfterRelease,
        dragRenders,
        dragStylesheetRewrites,
        releaseRenders,
      };
      await testInfo.attach("explorer-sidebar-resize-renders", {
        body: JSON.stringify(report, null, 2),
        contentType: "application/json",
      });
      console.log(`[perf] Explorer sidebar resize: ${JSON.stringify(report)}`);

      const dragDistance = RESIZE_DRAG_STEPS * RESIZE_DRAG_STEP_PX;
      expect(widthDuringDrag).toBeCloseTo(widthBefore + dragDistance, 0);
      expect(widthAfterRelease).toBeCloseTo(widthBefore + dragDistance, 0);
      expect(dragRenders.SplitContainer).toBe(0);
      expect(dragRenders.SplitPaneView).toBe(0);
      expect(dragRenders.RetainedPanel).toBe(0);
      expect(releaseRenders.SplitPaneView).toBe(0);
    } finally {
      await workspace.cleanup();
    }
  });
});

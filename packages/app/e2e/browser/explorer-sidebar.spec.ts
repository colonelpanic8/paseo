import type { Page } from "@playwright/test";
import { expect, test } from "../support/fixtures";
import { runWorkspaceActionFromCommandCenter } from "../support/helpers/command-center-workspace-actions";
import {
  installComponentRenderCounter,
  readComponentRenders,
  resetComponentRenders,
} from "../support/helpers/component-renders";
import {
  gotoWorkspace,
  pressNewTabShortcut,
  expectTabTitleFits,
} from "../support/helpers/launcher";
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

async function expectExplorerActiveTabForeground(
  page: Parameters<typeof ensureExplorerSidebar>[0],
) {
  await openFilesPanel(page);
  const main = page.getByTestId("workspace-pane-main");
  await main.hover();
  const activeMainLabel = main
    .getByTestId("workspace-tabs-row")
    .locator('[aria-selected="true"]')
    .getByText("New tab", { exact: true });
  const foreground = await activeMainLabel.evaluate((element) => getComputedStyle(element).color);
  const activeFiles = explorerSidebar(page).getByRole("button", {
    name: "Browse workspace files",
    exact: true,
  });
  await expect(activeFiles).toHaveAttribute("aria-selected", "true");
  await expect(activeFiles.getByText("Files", { exact: true })).toHaveCSS("color", foreground);
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
      await expect(explorer.getByTestId("workspace-tab-files")).toBeVisible();
      await expect(explorer.getByTestId("workspace-tab-changes_tree")).toBeVisible();
      await expect(explorer.getByTestId("workspace-new-tab-button")).toHaveCount(1);

      await expectExplorerActiveTabForeground(page);
      await expect(explorer.getByTestId("file-explorer-tree-scroll")).toBeVisible();

      await explorer.getByTestId("workspace-tab-changes_tree").click();
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

async function launchExplorerPanel(
  page: Parameters<typeof ensureExplorerSidebar>[0],
  name: string,
) {
  const explorer = explorerSidebar(page);
  await explorer.getByRole("button", { name: "New tab", exact: true }).click();
  await page.getByRole("menuitem", { name: new RegExp(`^${name}`) }).click();
  await explorer.getByRole("button", { name: "New tab", exact: true }).click();
  await expect(page.getByRole("menuitem", { name: new RegExp(`^${name}`) })).toHaveCount(0);
  await page.keyboard.press("Escape");
}

async function closeExplorerFilesFromContextMenu(
  page: Parameters<typeof ensureExplorerSidebar>[0],
) {
  const explorer = explorerSidebar(page);
  const files = explorer.getByRole("button", { name: "Browse workspace files", exact: true });
  await files.hover();
  await expect(explorer.getByTestId("workspace-files-close")).toHaveCount(0);
  await explorer.getByTestId("workspace-tab-changes_tree").hover();
  await expect(explorer.getByTestId("workspace-working-diff-close-changes_tree")).toHaveCount(0);
  await files.click({ button: "right", position: { x: 12, y: 13 } });
  await page.getByRole("menuitem", { name: "Close", exact: true }).click();
  await expect(files).toHaveCount(0);
}

async function expectWorkspaceCloseOnHover(page: Parameters<typeof ensureExplorerSidebar>[0]) {
  const main = page.getByTestId("workspace-pane-main");
  const tab = main.locator('[data-testid^="workspace-tab-"][aria-selected="true"]');
  const close = main.getByRole("button", { name: "Close", exact: true });
  await explorerSidebar(page).hover();
  await expect(close.locator("..")).toHaveCSS("opacity", "0");
  await tab.hover();
  await expect(close.locator("..")).toHaveCSS("opacity", "1");
}

async function closeOtherExplorerTabs(page: Parameters<typeof ensureExplorerSidebar>[0]) {
  const files = explorerSidebar(page).getByRole("button", {
    name: "Browse workspace files",
    exact: true,
  });
  await files.click({ button: "right", position: { x: 12, y: 13 } });
  const confirmation = page.waitForEvent("dialog").then((dialog) => {
    expect(dialog.message()).toContain("close 1 tab");
    return dialog.accept();
  });
  await page.getByRole("menuitem", { name: "Close other tabs", exact: true }).click();
  await confirmation;
}

test("Explorer keeps Files and Changes close actions in the context menu", async ({
  page,
}, testInfo) => {
  const workspace = await seedWorkspace({ repoPrefix: "explorer-shared-tabs-" });
  try {
    await gotoWorkspace(page, workspace.workspaceId);
    await waitForWorkspaceTabsVisible(page);
    const main = page.getByTestId("workspace-pane-main");
    const mainTabsBefore = await main.getByTestId("workspace-tabs-row").getByRole("button").count();
    const explorer = await ensureExplorerSidebar(page);
    await expectTabTitleFits(page, "Files", { min: 64, max: 90 });

    await test.step("Explorer's + menu excludes Agent and terminal profiles", async () => {
      await explorer.getByRole("button", { name: "New tab", exact: true }).click();
      const menu = page.getByTestId("workspace-new-tab-menu").filter({ visible: true });
      await expect(menu).toBeVisible();
      await expect(menu.getByRole("menuitem", { name: /^Agent/ })).toHaveCount(0);
      await expect(menu.getByRole("menuitem", { name: /^Files/ })).toHaveCount(0);
      await expect(menu.getByRole("menuitem", { name: /^Changes/ })).toHaveCount(0);
      await expect(menu.getByText("Terminal profiles", { exact: true })).toHaveCount(0);
      await expect(menu.getByRole("menuitem", { name: /^Terminal/ })).toBeVisible();
      const entries = await menu.getByRole("menuitem").allTextContents();
      expect(entries.findIndex((entry) => entry.startsWith("Terminal"))).toBeLessThan(
        entries.findIndex((entry) => entry.startsWith("Diff")),
      );
      await page.keyboard.press("Escape");
      await main.getByTestId("workspace-new-tab-button").click();
      await expect(menu).toBeVisible();
      await expect(menu.getByRole("menuitem", { name: /^Agent/ })).toBeVisible();
      await expect(menu.getByText("Terminal profiles", { exact: true })).toBeVisible();
      await page.keyboard.press("Escape");
    });

    await test.step("Files and Changes omit X, and + restores Files after context-menu close", async () => {
      await expectWorkspaceCloseOnHover(page);
      await closeExplorerFilesFromContextMenu(page);
      await launchExplorerPanel(page, "Files");
      await expect(
        explorer.getByRole("button", { name: "Browse workspace files", exact: true }),
      ).toBeVisible();
      await expect(explorer.getByTestId("file-explorer-tree-scroll")).toBeVisible();
    });

    await test.step("standard bulk-close menus affect only Explorer tabs", async () => {
      await closeOtherExplorerTabs(page);
      await expect(explorer.getByTestId("workspace-tab-changes_tree")).toHaveCount(0);
      await expect(explorer.getByTestId("workspace-tab-files")).toBeVisible();
      await expect(main.getByTestId("workspace-tabs-row").getByRole("button")).toHaveCount(
        mainTabsBefore,
      );
      await launchExplorerPanel(page, "Changes");
      await expect(explorer.getByTestId("changes-tree-panel")).toBeVisible();
    });

    await test.step("Cmd+T still belongs to the focused workspace pane", async () => {
      await pressNewTabShortcut(page);
      await expect(
        main.getByTestId("workspace-new-tab-panel").filter({ visible: true }),
      ).toBeVisible();
      await expect(explorer.getByTestId("workspace-new-tab-panel")).toHaveCount(0);
    });

    await testInfo.attach("shared-explorer-tabs", {
      body: await page.screenshot(),
      contentType: "image/png",
    });
  } finally {
    await workspace.cleanup();
  }
});

async function dragAgentIntoExplorer(
  page: Parameters<typeof ensureExplorerSidebar>[0],
  agentId: string,
) {
  const source = page
    .getByTestId("workspace-pane-main")
    .getByTestId(`workspace-tab-agent_${agentId}`);
  const destination = explorerSidebar(page).getByTestId("workspace-tab-files");
  const sourceBox = await source.boundingBox();
  const destinationBox = await destination.boundingBox();
  if (!sourceBox || !destinationBox)
    throw new Error("Tab drag requires visible source and destination");
  const start = { x: sourceBox.x + 12, y: sourceBox.y + sourceBox.height / 2 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 12, start.y + 4);
  await page.mouse.move(destinationBox.x + 12, destinationBox.y + destinationBox.height / 2, {
    steps: 20,
  });
  await page.mouse.up();
}

test("agents can still be dragged into Explorer when absent from its + menu", async ({
  page,
}, testInfo) => {
  const workspace = await seedWorkspace({ repoPrefix: "explorer-agent-drag-" });
  try {
    await gotoWorkspace(page, workspace.workspaceId);
    const explorer = await ensureExplorerSidebar(page);
    const agent = await workspace.client.createAgent({
      provider: "mock",
      cwd: workspace.repoPath,
      workspaceId: workspace.workspaceId,
      title: "Dragged agent",
      modeId: "load-test",
      model: "ten-second-stream",
    });
    const main = page.getByTestId("workspace-pane-main");
    await expect(main.getByTestId(`workspace-tab-agent_${agent.id}`)).toBeVisible();
    await dragAgentIntoExplorer(page, agent.id);
    await expect(explorer.getByTestId(`workspace-tab-agent_${agent.id}`)).toBeVisible();
    await expect(main.getByTestId(`workspace-tab-agent_${agent.id}`)).toHaveCount(0);
    await explorer.getByRole("button", { name: "New tab", exact: true }).click();
    const menu = page.getByTestId("workspace-new-tab-menu").filter({ visible: true });
    await expect(menu).toBeVisible();
    await expect(menu.getByRole("menuitem", { name: /^Agent/ })).toHaveCount(0);
    await expect(menu.getByText("Terminal profiles", { exact: true })).toHaveCount(0);
    await page.keyboard.press("Escape");
    await testInfo.attach("agent-in-explorer", {
      body: await page.screenshot(),
      contentType: "image/png",
    });
  } finally {
    await workspace.cleanup();
  }
});

import { writeFile } from "node:fs/promises";
import path from "node:path";
import type { Locator, Page } from "@playwright/test";
import { expect, test } from "../support/fixtures";
import {
  installComponentRenderCounter,
  readComponentRenders,
  resetComponentRenders,
} from "../support/helpers/component-renders";
import { openFileExplorer } from "../support/helpers/file-explorer";
import { gotoWorkspace } from "../support/helpers/launcher";
import { seedWorkspace } from "../support/helpers/seed-client";
import {
  openChangesTreePanel,
  waitForWorkspaceTabsVisible,
} from "../support/helpers/workspace-tabs";

const RESTING_NAME_OPACITY = "0.76";
const HOVERED_NAME_OPACITY = "1";

/** Hovers the row, then leaves it, and returns the row component's render count across both. */
async function hoverAndLeave(input: {
  page: Page;
  row: Locator;
  name: Locator;
  component: string;
}): Promise<number> {
  const { page, row, name, component } = input;
  await expect(name).toHaveCSS("opacity", RESTING_NAME_OPACITY);
  await resetComponentRenders(page);

  await row.hover();
  await expect(name).toHaveCSS("opacity", HOVERED_NAME_OPACITY);
  await page.mouse.move(0, 0);
  await expect(name).toHaveCSS("opacity", RESTING_NAME_OPACITY);

  const renders = await readComponentRenders(page, [component]);
  return renders[component] ?? 0;
}

test.describe("Tree row hover", () => {
  test("a Files row brightens its name on hover without re-rendering the row", async ({ page }) => {
    await installComponentRenderCounter(page);
    const workspace = await seedWorkspace({
      repoPrefix: "tree-row-hover-files-",
      repo: { files: [{ path: "docs/guide.md", content: "# Guide\n" }] },
    });

    try {
      await gotoWorkspace(page, workspace.workspaceId);
      await openFileExplorer(page);
      const name = page
        .getByTestId("file-explorer-tree-scroll")
        .locator('[data-testid^="file-explorer-row-"][data-testid$="-name"]')
        .filter({ hasText: /^docs$/ });
      const rowTestId = (await name.getAttribute("data-testid"))?.replace(/-name$/, "");
      if (!rowTestId) throw new Error("Files row for docs has no test id");

      const renders = await hoverAndLeave({
        page,
        row: page.getByTestId(rowTestId),
        name,
        component: "TreeRowItem",
      });
      expect(renders).toBe(0);
    } finally {
      await workspace.cleanup();
    }
  });

  test("a Changes folder row brightens its name on hover without re-rendering the row", async ({
    page,
  }) => {
    await installComponentRenderCounter(page);
    const workspace = await seedWorkspace({
      repoPrefix: "tree-row-hover-changes-",
      repo: { files: [{ path: "src/app.ts", content: "export const app = 1;\n" }] },
    });

    try {
      await writeFile(path.join(workspace.repoPath, "src/app.ts"), "export const app = 2;\n");
      await gotoWorkspace(page, workspace.workspaceId);
      await waitForWorkspaceTabsVisible(page);
      await openChangesTreePanel(page);
      const tree = page.getByTestId("changes-file-tree").filter({ visible: true });
      await expect(tree.getByTestId("diff-folder-src-toggle")).toBeVisible({ timeout: 30_000 });

      const renders = await hoverAndLeave({
        page,
        row: tree.getByTestId("diff-folder-src-toggle"),
        name: tree.getByTestId("diff-folder-src-name"),
        component: "DiffFolderRow",
      });
      expect(renders).toBe(0);
    } finally {
      await workspace.cleanup();
    }
  });
});

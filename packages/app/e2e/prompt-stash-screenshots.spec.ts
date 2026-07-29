import path from "node:path";
import { expect } from "@playwright/test";
import { test } from "./fixtures";
import { gotoAppShell } from "./helpers/app";
import {
  fillNewWorkspaceDraft,
  openNewWorkspaceComposer,
} from "./helpers/new-workspace";
import { seedWorkspace, type SeededWorkspace } from "./helpers/seed-client";
import { waitForSidebarHydration } from "./helpers/workspace-ui";

/**
 * Capture-only spec for the composer prompt stash. Not a behavioral test —
 * it drives the real app to produce PR screenshot evidence for the badge,
 * the picker, and the undo toast, which unit tests cannot show.
 *
 * Screenshots land in `packages/app/e2e/screenshots/`.
 */

const OUT_DIR = path.resolve(__dirname, "screenshots");

const FIRST_PROMPT =
  "Investigate the workspace startup failure — trace the request from the app through the daemon and explain the root cause before changing anything.";
const SECOND_PROMPT = "Also add a regression test for the archive path once that lands.";

test.describe("Prompt stash screenshots", () => {
  test.describe.configure({ timeout: 240_000 });

  test("captures badge, picker, and undo toast", async ({ page }) => {
    const project: SeededWorkspace = await seedWorkspace({
      repoPrefix: "prompt-stash-screens-",
    });

    try {
      await gotoAppShell(page);
      await waitForSidebarHydration(page);
      await openNewWorkspaceComposer(page, {
        projectKey: project.projectId,
        projectDisplayName: project.projectDisplayName,
      });

      const composer = page.getByRole("textbox", { name: "Message agent..." });
      await expect(composer).toBeVisible({ timeout: 30_000 });

      // --- 1. Stash a prompt: undo toast + badge appear together ---
      await fillNewWorkspaceDraft(page, FIRST_PROMPT);
      await composer.focus();
      await page.keyboard.press("Control+s");

      const undoButton = page.getByTestId("composer-stash-undo");
      await expect(undoButton).toBeVisible({ timeout: 10_000 });
      await expect(composer).toHaveValue("");
      await page.screenshot({ path: path.join(OUT_DIR, "01-undo-toast.png") });

      const badge = page.getByTestId("composer-stash-badge");
      await expect(badge).toBeVisible({ timeout: 10_000 });

      // --- 2. Badge with a count of 2 ---
      // Wait out the toast so it does not cover the composer shoulder.
      await expect(undoButton).not.toBeVisible({ timeout: 15_000 });
      await fillNewWorkspaceDraft(page, SECOND_PROMPT);
      await composer.focus();
      await page.keyboard.press("Control+s");
      await expect(composer).toHaveValue("");
      await expect(page.getByTestId("composer-stash-undo")).not.toBeVisible({ timeout: 15_000 });
      await expect(badge).toContainText("2");
      await page.screenshot({ path: path.join(OUT_DIR, "02-badge-count.png") });

      // --- 3. Picker open above the composer (ctrl+S on an empty composer) ---
      await composer.focus();
      await page.keyboard.press("Control+s");
      const stashOptions = page.locator('[data-testid^="composer-stash-option-"]');
      await expect(stashOptions.first()).toBeVisible({ timeout: 10_000 });
      await expect(stashOptions).toHaveCount(2);
      await page.screenshot({ path: path.join(OUT_DIR, "03-picker-open.png") });

      // --- 4. Restore puts the prompt back in the composer ---
      await page.keyboard.press("Enter");
      await expect(composer).toHaveValue(SECOND_PROMPT, { timeout: 10_000 });
      await page.screenshot({ path: path.join(OUT_DIR, "04-restored.png") });
    } finally {
      await project.cleanup();
    }
  });
});

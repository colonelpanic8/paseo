import { defineConfig, devices } from "@playwright/test";
import baseConfig from "./playwright.config";

/**
 * Temporary local override: on NixOS the Playwright-bundled Chromium cannot
 * resolve libglib-2.0.so.0, so drive the system Chrome instead. Not committed.
 */
export default defineConfig({
  ...baseConfig,
  projects: [
    {
      name: "Desktop Chrome",
      testIgnore: ["**/*.real.spec.ts"],
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: {
          executablePath: process.env.SCREENSHOT_CHROME_PATH,
        },
      },
    },
  ],
});

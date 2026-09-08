import { defineConfig, devices } from "@playwright/test";

const appRoot = "/home/imalison/Projects/paseo/.worktrees/evidence-4261/packages/app";

export default defineConfig({
  testDir: `${appRoot}/e2e/browser`,
  globalSetup: `${appRoot}/e2e/support/global-setup.ts`,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    ...devices["Desktop Chrome"],
    launchOptions: {
      executablePath: "/home/imalison/bin/google-chrome-stable",
    },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "on",
  },
  projects: [{ name: "browser" }],
});

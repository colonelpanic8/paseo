import assert from "node:assert/strict";
import { copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const scriptPath = new URL("postinstall-patches.mjs", import.meta.url);

async function createFixture({ patchedDependency = false } = {}) {
  const fixture = await mkdtemp(join(tmpdir(), "paseo-postinstall-patches-"));
  await copyFile(scriptPath, join(fixture, "postinstall-patches.mjs"));
  await mkdir(join(fixture, "patches"));
  await writeFile(join(fixture, "patches", "react-native-markdown-display+1.0.0.patch"), "patch");
  if (patchedDependency) {
    await mkdir(join(fixture, "node_modules", "react-native-markdown-display"), {
      recursive: true,
    });
  }
  return fixture;
}

function runPostinstall(fixture, env = {}) {
  return spawnSync(process.execPath, ["postinstall-patches.mjs"], {
    cwd: fixture,
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
}

test("succeeds without patch-package when no patched dependency is installed", async (t) => {
  const fixture = await createFixture();
  t.after(() => rm(fixture, { recursive: true, force: true }));

  const result = runPostinstall(fixture, { NODE_ENV: "production", npm_config_omit: "dev" });

  assert.equal(result.status, 0);
  assert.equal(result.stderr, "");
});

test("fails when a required patch is present but patch-package was omitted", async (t) => {
  const fixture = await createFixture({ patchedDependency: true });
  t.after(() => rm(fixture, { recursive: true, force: true }));

  const result = runPostinstall(fixture, { NODE_ENV: "production", npm_config_omit: "dev" });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /required dependency patches could not be applied/);
  assert.match(result.stderr, /npm ci --include=dev/);
});

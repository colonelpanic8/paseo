import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test } from "vitest";

import { createTestLogger } from "../../../test-utils/test-logger.js";
import { OpenCodeAgentClient } from "./opencode-agent.js";
import {
  TestOpenCodeClient,
  TestOpenCodeHarness,
} from "./opencode/test-utils/test-opencode-harness.js";

const PROVIDER_LIST_RESPONSE = {
  data: {
    connected: ["openai"],
    all: [{ id: "openai", name: "OpenAI", source: "env", models: {} }],
  },
};

function createHarness(): { runtime: TestOpenCodeHarness; enqueue: () => void } {
  const runtime = new TestOpenCodeHarness();
  const enqueue = () => {
    const openCodeClient = new TestOpenCodeClient();
    openCodeClient.providerListResponse = PROVIDER_LIST_RESPONSE;
    runtime.enqueueClient(openCodeClient);
  };
  return { runtime, enqueue };
}

async function createOpenCodeXdgHome(): Promise<{
  env: Record<string, string>;
  writeModelCatalog: (contents: string) => Promise<void>;
}> {
  const home = await mkdtemp(path.join(tmpdir(), "opencode-catalog-"));
  const cacheDir = path.join(home, "cache", "opencode");
  await mkdir(cacheDir, { recursive: true });
  return {
    env: {
      HOME: home,
      XDG_CACHE_HOME: path.join(home, "cache"),
      XDG_DATA_HOME: path.join(home, "data"),
      XDG_CONFIG_HOME: path.join(home, "config"),
    },
    writeModelCatalog: (contents: string) =>
      writeFile(path.join(cacheDir, "models.json"), contents, "utf8"),
  };
}

test("the catalogue key follows OpenCode's model cache", async () => {
  const { runtime } = createHarness();
  const { env, writeModelCatalog } = await createOpenCodeXdgHome();
  const client = new OpenCodeAgentClient(
    createTestLogger(),
    { env },
    { serverManager: runtime, createClient: runtime.createClient },
  );
  const options = { scope: "workspace", cwd: "/workspace/repo", force: false } as const;

  await writeModelCatalog(JSON.stringify({ opencode: { models: {} } }));
  const before = await client.getCatalogCacheKey(options);

  await writeModelCatalog(JSON.stringify({ opencode: { models: { "union-alpha": {} } } }));
  const after = await client.getCatalogCacheKey(options);

  expect(after).not.toBe(before);
  expect(await client.getCatalogCacheKey(options)).toBe(after);

  // OpenCode rewrites its cache on every run; identical models are not a change.
  await writeModelCatalog(JSON.stringify({ opencode: { models: { "union-alpha": {} } } }));
  expect(await client.getCatalogCacheKey(options)).toBe(after);
});

test("a changed catalogue replaces the server instead of asking the old one again", async () => {
  const { runtime, enqueue } = createHarness();
  let fingerprint = "catalog-1";
  const client = new OpenCodeAgentClient(createTestLogger(), undefined, {
    serverManager: runtime,
    createClient: runtime.createClient,
    readCatalogFingerprint: async () => fingerprint,
  });
  const options = { scope: "workspace", cwd: "/workspace/repo", force: false } as const;
  // The snapshot manager resolves the key immediately before each discovery.
  const discover = async () => {
    await client.getCatalogCacheKey(options);
    enqueue();
    await client.fetchCatalog(options);
    return runtime.acquisitions.map(({ kind }) => kind);
  };

  await discover();
  expect(await discover()).toEqual(["current", "current"]);

  fingerprint = "catalog-2";
  expect(await discover()).toEqual(["current", "current", "new"]);
  expect(await discover()).toEqual(["current", "current", "new", "current"]);
});

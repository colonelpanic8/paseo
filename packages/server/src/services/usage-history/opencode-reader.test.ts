import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestLogger } from "../../test-utils/test-logger.js";
import { listOpenCodeDatabases, readOpenCodeDatabase } from "./opencode-reader.js";

let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "usage-opencode-test-"));
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe("listOpenCodeDatabases", () => {
  it("finds channel databases while ignoring sidecars and stale files", async () => {
    const fresh = path.join(root, "opencode-stable.db");
    const stale = path.join(root, "opencode.db");
    await fs.writeFile(fresh, "fresh");
    await fs.writeFile(stale, "stale");
    await fs.writeFile(path.join(root, "opencode-stable.db-shm"), "sidecar");
    await fs.writeFile(path.join(root, "notes.txt"), "notes");
    const old = new Date(Date.parse("2026-01-01T00:00:00Z"));
    await fs.utimes(stale, old, old);

    const found = await listOpenCodeDatabases(root, Date.parse("2026-07-01T00:00:00Z"));
    expect(found.map((db) => db.path)).toEqual([fresh]);
  });

  it("returns nothing when the data directory does not exist", async () => {
    await expect(listOpenCodeDatabases(path.join(root, "gone"), 0)).resolves.toEqual([]);
  });
});

describe("readOpenCodeDatabase", () => {
  it("returns null when the database cannot be read", async () => {
    await expect(
      readOpenCodeDatabase(path.join(root, "missing.db"), { logger: createTestLogger() }),
    ).resolves.toBeNull();
  });
});

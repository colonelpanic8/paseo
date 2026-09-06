import { mkdtemp, mkdir, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, test } from "vitest";
import { createPersistedWorkspaceRecord } from "../workspace-registry.js";
import { pruneMissingWorkspaces } from "./workspace-pruning.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "paseo-prune-"));
  roots.push(root);
  await mkdir(path.join(root, "present"));
  const workspaces = ["present", "missing", "archived", "other"].map((name) =>
    createPersistedWorkspaceRecord({
      workspaceId: name,
      projectId: name === "other" ? "other-project" : "project",
      cwd: path.join(root, name),
      kind: "directory",
      displayName: name,
      createdAt: "2026-09-06T00:00:00.000Z",
      updatedAt: "2026-09-06T00:00:00.000Z",
      archivedAt: name === "archived" ? "2026-09-06T00:00:00.000Z" : null,
    }),
  );
  const archived: string[] = [];
  return {
    root,
    archived,
    dependencies: {
      listWorkspaces: async () => workspaces,
      archiveWorkspace: async (id: string) => {
        archived.push(id);
      },
    },
  };
}

test("prunes only active missing workspaces within the requested project", async () => {
  const { root, archived, dependencies } = await fixture();
  expect(await pruneMissingWorkspaces(dependencies, { projectId: "project" })).toEqual({
    workspaces: [{ workspaceId: "missing", directory: path.join(root, "missing") }],
    errors: [],
  });
  expect(archived).toEqual(["missing"]);
});

test("dry run lists missing directories across projects without archiving", async () => {
  const { root, archived, dependencies } = await fixture();
  expect(await pruneMissingWorkspaces(dependencies, { dryRun: true })).toEqual({
    workspaces: [
      { workspaceId: "missing", directory: path.join(root, "missing") },
      { workspaceId: "other", directory: path.join(root, "other") },
    ],
    errors: [],
  });
  expect(archived).toEqual([]);
});

test("an empty project filter never expands cleanup to all projects", async () => {
  const { archived, dependencies } = await fixture();
  expect(await pruneMissingWorkspaces(dependencies, { projectId: "" })).toEqual({
    workspaces: [],
    errors: [],
  });
  expect(archived).toEqual([]);
});

test("reports inaccessible paths without treating them as missing", async () => {
  const { root, archived, dependencies } = await fixture();
  // A symlink loop produces ELOOP even when the test runs as root.
  await symlink("missing", path.join(root, "missing"));
  const result = await pruneMissingWorkspaces(dependencies, {});
  expect(result.workspaces).toEqual([
    { workspaceId: "other", directory: path.join(root, "other") },
  ]);
  expect(result.errors).toEqual([
    {
      workspaceId: "missing",
      directory: path.join(root, "missing"),
      error: expect.stringContaining("ELOOP"),
    },
  ]);
  expect(archived).toEqual(["other"]);
});

test("reports archive failures and continues cleaning independent workspaces", async () => {
  const { root, archived, dependencies } = await fixture();
  const archiveWorkspace = dependencies.archiveWorkspace;
  dependencies.archiveWorkspace = async (id) => {
    if (id === "missing") throw new Error("Archive failed");
    await archiveWorkspace(id);
  };
  expect(await pruneMissingWorkspaces(dependencies, {})).toEqual({
    workspaces: [{ workspaceId: "other", directory: path.join(root, "other") }],
    errors: [
      { workspaceId: "missing", directory: path.join(root, "missing"), error: "Archive failed" },
    ],
  });
  expect(archived).toEqual(["other"]);
});

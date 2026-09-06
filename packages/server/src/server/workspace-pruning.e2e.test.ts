import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { createPaseoApi } from "@getpaseo/client";
import { expect, test } from "vitest";
import { createDaemonTestContext } from "./test-utils/index.js";

test("previews and prunes missing workspaces over the daemon connection", async () => {
  const ctx = await createDaemonTestContext();
  const root = await mkdtemp(path.join(tmpdir(), "paseo-prune-e2e-"));
  try {
    const api = createPaseoApi(ctx.client);
    const runCli = (args: string[]) =>
      promisify(execFile)(
        process.execPath,
        [
          "--import",
          "tsx",
          fileURLToPath(new URL("../../../cli/src/index.ts", import.meta.url)),
          "workspace",
          "prune",
          "--host",
          `127.0.0.1:${ctx.daemon.port}`,
          "--json",
          ...args,
        ],
        {
          env: { ...process.env, PASEO_HOME: ctx.daemon.paseoHome, PASEO_PASSWORD: "" },
          timeout: 15_000,
        },
      );
    const missingDirectory = path.join(root, "missing");
    await mkdir(missingDirectory);
    const present = await ctx.client.createWorkspace({ source: { kind: "directory", path: root } });
    const missing = await ctx.client.createWorkspace({
      source: { kind: "directory", path: missingDirectory },
    });
    if (!present.workspace || !missing.workspace) throw new Error("Workspace creation failed");
    await rm(missingDirectory, { recursive: true });

    const entry = { workspaceId: missing.workspace.id, directory: missingDirectory };
    expect(await api.workspaces.prune({ dryRun: true })).toMatchObject({
      dryRun: true,
      workspaces: [entry],
      errors: [],
      error: null,
    });
    const preview = await runCli(["--dry-run", "--project", missing.workspace.projectId]);
    expect(JSON.parse(preview.stdout)).toEqual([{ ...entry, status: "would_archive" }]);
    const before = await ctx.client.fetchWorkspaces();
    expect(before.entries.map((workspace) => workspace.id)).toContain(missing.workspace.id);

    const pruned = await runCli([]);
    expect(JSON.parse(pruned.stdout)).toEqual([{ ...entry, status: "archived" }]);
    const after = await ctx.client.fetchWorkspaces();
    expect(after.entries.map((workspace) => workspace.id)).toEqual([present.workspace.id]);
    expect(await ctx.client.pruneWorkspaces()).toMatchObject({
      workspaces: [],
      errors: [],
      error: null,
    });
    expect(await ctx.client.pruneWorkspaces({ projectId: "unknown-project" })).toMatchObject({
      workspaces: [],
      errors: [],
      error: "Project not found: unknown-project",
    });
    await expect(runCli(["--project", "unknown-project"])).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringContaining("Project not found: unknown-project"),
    });
  } finally {
    await ctx.cleanup();
    await rm(root, { recursive: true, force: true });
  }
});

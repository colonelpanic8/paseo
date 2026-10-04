// POSIX-only: exercises real bash shell fixtures
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { isPlatform } from "../test-utils/platform.js";
import {
  AgentEnvCaptureError,
  captureAgentEnv,
  diffCapturedEnv,
  parseNulDelimitedEnv,
  resolveAgentEnvCommand,
} from "./agent-env.js";

describe("parseNulDelimitedEnv", () => {
  it("parses NUL-delimited entries including multi-line values", () => {
    const output = ["FOO=bar", "MULTI=line1\nline2", "EMPTY=", "no-separator-noise"].join("\0");

    expect(parseNulDelimitedEnv(output)).toEqual({
      FOO: "bar",
      MULTI: "line1\nline2",
      EMPTY: "",
    });
  });
});

describe("diffCapturedEnv", () => {
  it("returns only added or changed vars and skips shell bookkeeping keys", () => {
    const overlay = diffCapturedEnv(
      { HOME: "/home/u", API_KEY: "old", PWD: "/base" },
      {
        HOME: "/home/u",
        API_KEY: "new",
        EXTRA: "1",
        PWD: "/project",
        SHLVL: "2",
        _: "/usr/bin/env",
      },
    );

    expect(overlay).toEqual({ API_KEY: "new", EXTRA: "1" });
  });
});

describe.skipIf(isPlatform("win32"))("captureAgentEnv", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "paseo-agent-env-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("captures vars exported by the wrapper command", async () => {
    const overlay = await captureAgentEnv({
      command: "env AGENT_ENV_TEST_VAR=from-wrapper",
      cwd: dir,
    });

    expect(overlay.AGENT_ENV_TEST_VAR).toBe("from-wrapper");
    expect(overlay.HOME).toBeUndefined();
  });

  it("runs the command in the agent cwd", async () => {
    writeFileSync(path.join(dir, "project-env.sh"), 'export FROM_SCRIPT="$PWD"\n');
    const overlay = await captureAgentEnv({
      command: "sh -c '. ./project-env.sh && exec \"$@\"' --",
      cwd: dir,
    });

    expect(overlay.FROM_SCRIPT).toBe(dir);
  });

  it("throws AgentEnvCaptureError with stderr detail when the command fails", async () => {
    await expect(
      captureAgentEnv({ command: "echo blocked-by-test >&2; false", cwd: dir }),
    ).rejects.toThrowError(AgentEnvCaptureError);
    await expect(
      captureAgentEnv({ command: "echo blocked-by-test >&2; false", cwd: dir }),
    ).rejects.toThrow(/blocked-by-test/);
  });

  it("throws a timeout detail when the command hangs", async () => {
    await expect(
      captureAgentEnv({ command: "sleep 5;", cwd: dir, timeoutMs: 200 }),
    ).rejects.toThrow(/timed out after 200ms/);
  });
});

describe("resolveAgentEnvCommand", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "paseo-agent-env-config-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns the agentEnv command from paseo.json in the cwd", () => {
    writeFileSync(path.join(dir, "paseo.json"), JSON.stringify({ agentEnv: "direnv exec ." }));

    expect(resolveAgentEnvCommand(dir)).toBe("direnv exec .");
  });

  it("walks up from a subdirectory to the project paseo.json", () => {
    writeFileSync(path.join(dir, "paseo.json"), JSON.stringify({ agentEnv: "direnv exec ." }));
    const nested = path.join(dir, "packages", "app");
    mkdirSync(nested, { recursive: true });

    expect(resolveAgentEnvCommand(nested)).toBe("direnv exec .");
  });

  it("returns null when paseo.json has no agentEnv", () => {
    writeFileSync(path.join(dir, "paseo.json"), JSON.stringify({ worktree: {} }));

    expect(resolveAgentEnvCommand(dir)).toBeNull();
  });

  it("stops at the repository boundary without picking up configs above it", () => {
    writeFileSync(path.join(dir, "paseo.json"), JSON.stringify({ agentEnv: "direnv exec ." }));
    const repo = path.join(dir, "repo");
    mkdirSync(repo, { recursive: true });
    execFileSync("git", ["init", "--quiet"], { cwd: repo });

    expect(resolveAgentEnvCommand(repo)).toBeNull();
  });

  it("throws on malformed paseo.json instead of silently skipping", () => {
    writeFileSync(path.join(dir, "paseo.json"), "{ not json");

    expect(() => resolveAgentEnvCommand(dir)).toThrow(/Failed to parse paseo\.json/);
  });
});

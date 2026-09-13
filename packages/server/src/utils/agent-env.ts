import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

import { createExternalProcessEnv, type ProcessEnvRecord } from "../server/paseo-env.js";
import { resolvePaseoConfigPath } from "./paseo-config-file.js";
import { execCommand } from "./spawn.js";
import {
  buildStringCommandShellInvocation,
  createStringCommandShellEnvOverlay,
} from "./string-command-shell.js";
import { paseoConfigParseError, readPaseoConfig } from "./worktree.js";

export const AGENT_ENV_CAPTURE_TIMEOUT_MS = 30_000;
const AGENT_ENV_CAPTURE_MAX_BUFFER = 4 * 1024 * 1024;

// Shell bookkeeping vars that differ per invocation without carrying project config.
const AGENT_ENV_IGNORED_KEYS = new Set(["PWD", "OLDPWD", "SHLVL", "_"]);

export class AgentEnvCaptureError extends Error {
  constructor(
    public readonly command: string,
    public readonly cwd: string,
    public readonly detail: string,
  ) {
    super(`agentEnv command '${command}' failed in ${cwd}: ${detail}`);
    this.name = "AgentEnvCaptureError";
  }
}

// Walk up from the agent cwd to the first directory that has a paseo.json,
// stopping at the repository boundary (a .git directory or worktree .git file)
// so an unrelated config above the checkout is never picked up.
export function resolveAgentEnvCommand(cwd: string): string | null {
  let dir = cwd;
  for (;;) {
    if (existsSync(resolvePaseoConfigPath(dir))) {
      const result = readPaseoConfig(dir);
      if (!result.ok) {
        throw paseoConfigParseError(result);
      }
      const command = result.config?.agentEnv?.trim();
      return command ? command : null;
    }
    if (existsSync(join(dir, ".git"))) {
      return null;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      return null;
    }
    dir = parent;
  }
}

export function parseNulDelimitedEnv(output: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const entry of output.split("\0")) {
    const separator = entry.indexOf("=");
    if (separator <= 0) {
      continue;
    }
    env[entry.slice(0, separator)] = entry.slice(separator + 1);
  }
  return env;
}

export function diffCapturedEnv(
  baseEnv: ProcessEnvRecord,
  capturedEnv: Record<string, string>,
): Record<string, string> {
  const overlay: Record<string, string> = {};
  for (const [key, value] of Object.entries(capturedEnv)) {
    if (AGENT_ENV_IGNORED_KEYS.has(key)) {
      continue;
    }
    if (baseEnv[key] !== value) {
      overlay[key] = value;
    }
  }
  return overlay;
}

export interface CaptureAgentEnvOptions {
  command: string;
  cwd: string;
  baseEnv?: ProcessEnvRecord;
  timeoutMs?: number;
}

interface ExecCommandFailure {
  code?: number | string | null;
  killed?: boolean;
  stderr?: string;
  message?: string;
}

function describeCaptureFailure(error: unknown, timeoutMs: number): string {
  const failure = (error ?? {}) as ExecCommandFailure;
  if (failure.killed) {
    return `timed out after ${timeoutMs}ms`;
  }
  const stderr = typeof failure.stderr === "string" ? failure.stderr.trim() : "";
  const exit = failure.code !== undefined && failure.code !== null ? `exit ${failure.code}` : "";
  const parts = [exit, stderr].filter((part) => part.length > 0);
  return parts.length > 0 ? parts.join(": ") : (failure.message ?? String(error));
}

// Run the committed agentEnv wrapper command once in the agent cwd, dump the
// resulting environment (`<command> env -0`), and return only the vars it added
// or changed relative to the daemon environment. POSIX-only for now.
export async function captureAgentEnv(
  options: CaptureAgentEnvOptions,
): Promise<Record<string, string>> {
  const timeoutMs = options.timeoutMs ?? AGENT_ENV_CAPTURE_TIMEOUT_MS;
  const baseEnv = createExternalProcessEnv(
    options.baseEnv ?? process.env,
    createStringCommandShellEnvOverlay(),
  );
  const invocation = buildStringCommandShellInvocation({
    command: `${options.command} env -0`,
  });
  try {
    const { stdout } = await execCommand(invocation.shell, invocation.args, {
      cwd: options.cwd,
      baseEnv,
      timeout: timeoutMs,
      maxBuffer: AGENT_ENV_CAPTURE_MAX_BUFFER,
    });
    return diffCapturedEnv(baseEnv, parseNulDelimitedEnv(stdout));
  } catch (error) {
    throw new AgentEnvCaptureError(
      options.command,
      options.cwd,
      describeCaptureFailure(error, timeoutMs),
    );
  }
}

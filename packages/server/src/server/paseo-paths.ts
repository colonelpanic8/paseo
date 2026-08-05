import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { ensurePrivateDirectory } from "./private-files.js";

/**
 * The four lifecycles Paseo's on-disk files fall into. Call sites name the category they want
 * instead of joining off a single root, so the roots can diverge without another sweep.
 */
export type PaseoPathCategory = "config" | "data" | "state" | "cache";

export type PaseoLayout = "flat" | "xdg";

export interface PaseoPaths {
  /**
   * Historical single root. Equal to every category under `flat`, and to `data` under `xdg`, so
   * a call site that has not been classified yet keeps landing somewhere sane.
   */
  home: string;
  config: string;
  data: string;
  state: string;
  cache: string;
  layout: PaseoLayout;
}

export const LEGACY_PASEO_HOME = "~/.paseo";

/**
 * `HOME` from the caller's env rather than `os.homedir()`, so an injected environment resolves
 * consistently: the XDG variables and the `~` they may contain have to agree on one home.
 */
function homeDirectory(env: NodeJS.ProcessEnv): string {
  return env.HOME?.trim() || os.homedir();
}

function expandHomeDir(input: string, env: NodeJS.ProcessEnv): string {
  if (input.startsWith("~/")) {
    return path.join(homeDirectory(env), input.slice(2));
  }
  if (input === "~") {
    return homeDirectory(env);
  }
  return input;
}

function xdgRoot(env: NodeJS.ProcessEnv, variable: string, fallback: string): string {
  const configured = env[variable]?.trim();
  const base = configured
    ? expandHomeDir(configured, env)
    : path.join(homeDirectory(env), fallback);
  return path.join(path.resolve(base), "paseo");
}

function flatPaths(root: string): PaseoPaths {
  const resolved = path.resolve(root);
  return {
    home: resolved,
    config: resolved,
    data: resolved,
    state: resolved,
    cache: resolved,
    layout: "flat",
  };
}

/**
 * Resolution order, chosen so no existing install changes shape on upgrade:
 *
 * 1. `PASEO_HOME` set — the flat layout, rooted where the user asked. Unchanged from before.
 * 2. `~/.paseo` already exists — the flat layout. Every install that predates this code takes
 *    this branch and keeps its exact current directory layout until a migration is requested.
 * 3. Otherwise (a fresh install, with no legacy directory to honor) — the XDG layout.
 *
 * Detection deliberately runs before any directory is created: `ensurePrivateDirectory` would
 * otherwise make `~/.paseo` on the first call and pin every later call to the flat layout.
 */
export function resolvePaseoPaths(env: NodeJS.ProcessEnv = process.env): PaseoPaths {
  const configuredHome = env.PASEO_HOME?.trim();
  if (configuredHome) {
    return ensurePaths(flatPaths(expandHomeDir(configuredHome, env)));
  }

  const legacyHome = expandHomeDir(LEGACY_PASEO_HOME, env);
  if (existsSync(legacyHome)) {
    return ensurePaths(flatPaths(legacyHome));
  }

  // Only `config` diverges for now. `data`, `state` and `cache` are distinct categories at every
  // call site but resolve to one root, so no file can land in the wrong place before the sweep
  // that classifies them. Pointing them at their own XDG roots later is a change here plus a
  // migration for the files that move — not another pass over the call sites.
  const data = xdgRoot(env, "XDG_DATA_HOME", ".local/share");
  return ensurePaths({
    home: data,
    config: xdgRoot(env, "XDG_CONFIG_HOME", ".config"),
    data,
    state: data,
    cache: data,
    layout: "xdg",
  });
}

function ensurePaths(paths: PaseoPaths): PaseoPaths {
  for (const directory of new Set([paths.config, paths.data, paths.state, paths.cache])) {
    ensurePrivateDirectory(directory);
  }
  return paths;
}

export function resolvePaseoPath(
  category: PaseoPathCategory,
  env: NodeJS.ProcessEnv = process.env,
): string {
  return resolvePaseoPaths(env)[category];
}

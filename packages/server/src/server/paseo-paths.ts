import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";

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
 * 3. Not Linux — the flat layout. XDG is a Linux convention; macOS and Windows have their own,
 *    and choosing one for them is a separate decision from separating config out of the home
 *    directory. Nothing changes on those platforms.
 * 4. Otherwise (a fresh Linux install, with no legacy directory to honor) — the XDG layout.
 *
 * Resolving is free of side effects, so detection cannot be poisoned by a directory an earlier
 * call created: creating `~/.paseo` here would pin every later call to the flat layout.
 *
 * The answer is also decided once per environment and cached. Step 2 asks the filesystem a
 * question whose answer can change while the process runs — an older release or another tool
 * creating `~/.paseo` — and without the cache a daemon that started under XDG would silently
 * begin reading and writing `~/.paseo/config.json` while its data root stayed where it was.
 * The layout a process starts with is the layout it keeps.
 */
const resolvedPaths = new Map<string, PaseoPaths>();

export function resolvePaseoPaths(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): PaseoPaths {
  // Every input resolution reads. A new one must be added here too, or two environments that
  // differ only by it would share an answer.
  const key = JSON.stringify([
    platform,
    env.PASEO_HOME,
    env.HOME,
    env.XDG_CONFIG_HOME,
    env.XDG_DATA_HOME,
    env.XDG_STATE_HOME,
    env.XDG_CACHE_HOME,
  ]);
  const cached = resolvedPaths.get(key);
  if (cached) {
    return cached;
  }
  const paths = computePaseoPaths(env, platform);
  resolvedPaths.set(key, paths);
  return paths;
}

function computePaseoPaths(env: NodeJS.ProcessEnv, platform: NodeJS.Platform): PaseoPaths {
  const configuredHome = env.PASEO_HOME?.trim();
  if (configuredHome) {
    return flatPaths(expandHomeDir(configuredHome, env));
  }

  const legacyHome = expandHomeDir(LEGACY_PASEO_HOME, env);
  if (existsSync(legacyHome) || platform !== "linux") {
    return flatPaths(legacyHome);
  }

  // Only `config` diverges for now. `data`, `state` and `cache` are distinct categories at every
  // call site but resolve to one root, so no file can land in the wrong place before the sweep
  // that classifies them. Pointing them at their own XDG roots later is a change here plus a
  // migration for the files that move — not another pass over the call sites.
  const data = xdgRoot(env, "XDG_DATA_HOME", ".local/share");
  return {
    home: data,
    config: xdgRoot(env, "XDG_CONFIG_HOME", ".config"),
    data,
    state: data,
    cache: data,
    layout: "xdg",
  };
}

export function resolvePaseoPath(
  category: PaseoPathCategory,
  env: NodeJS.ProcessEnv = process.env,
): string {
  return resolvePaseoPaths(env)[category];
}

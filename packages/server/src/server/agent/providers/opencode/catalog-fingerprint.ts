import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

/**
 * OpenCode reads its model catalogue once per process from a cache file it
 * refreshes in the background, so a running server keeps serving the catalogue
 * it booted with and asking it again can never reveal a newly published model.
 * Fingerprint the files that decide the catalogue instead: when one changes,
 * OpenCode has a different answer to give and the cached one is worth
 * replacing.
 *
 * The fingerprint is content-based because OpenCode rewrites its cache on every
 * run, and a fresh mtime carrying identical models is not worth a discovery.
 * Hashing is keyed on size and mtime so the hot path stays at one stat per file.
 */
const CATALOG_FILES = {
  models: ["opencode", "models.json"],
  auth: ["opencode", "auth.json"],
} as const;

const CONFIG_FILENAMES = ["opencode.json", "opencode.jsonc"] as const;

const contentHashes = new Map<string, { stamp: string; hash: string }>();

function resolveHome(env: NodeJS.ProcessEnv): string {
  return env.HOME?.trim() || homedir();
}

function resolveXdgDir(
  env: NodeJS.ProcessEnv,
  variable: "XDG_CACHE_HOME" | "XDG_DATA_HOME" | "XDG_CONFIG_HOME",
  fallback: readonly string[],
): string {
  const configured = env[variable]?.trim();
  return configured ? configured : path.join(resolveHome(env), ...fallback);
}

/** Every file whose contents can change what OpenCode reports as available. */
export function openCodeCatalogSourcePaths(
  env: NodeJS.ProcessEnv,
  directory: string,
): readonly string[] {
  const configDir = path.join(resolveXdgDir(env, "XDG_CONFIG_HOME", [".config"]), "opencode");
  const explicitConfig = env.OPENCODE_CONFIG?.trim();
  return [
    path.join(resolveXdgDir(env, "XDG_CACHE_HOME", [".cache"]), ...CATALOG_FILES.models),
    path.join(resolveXdgDir(env, "XDG_DATA_HOME", [".local", "share"]), ...CATALOG_FILES.auth),
    ...CONFIG_FILENAMES.map((name) => path.join(configDir, name)),
    ...(directory ? CONFIG_FILENAMES.map((name) => path.join(directory, name)) : []),
    ...(explicitConfig ? [explicitConfig] : []),
  ];
}

async function fingerprintFile(file: string): Promise<string> {
  let stamp: string;
  try {
    const stats = await stat(file);
    stamp = `${stats.mtimeMs}:${stats.size}`;
  } catch {
    contentHashes.delete(file);
    return `${file}:-`;
  }

  const cached = contentHashes.get(file);
  if (cached?.stamp === stamp) return `${file}:${cached.hash}`;

  try {
    const hash = createHash("sha256")
      .update(await readFile(file))
      .digest("hex")
      .slice(0, 16);
    contentHashes.set(file, { stamp, hash });
    return `${file}:${hash}`;
  } catch {
    contentHashes.delete(file);
    return `${file}:${stamp}`;
  }
}

export async function readOpenCodeCatalogFingerprint(
  env: NodeJS.ProcessEnv,
  directory: string,
): Promise<string> {
  const parts = await Promise.all(
    openCodeCatalogSourcePaths(env, directory).map((file) => fingerprintFile(file)),
  );
  return parts.join("|");
}

import type { BuildInfo } from "@getpaseo/protocol/messages";

/**
 * Build provenance for the running daemon.
 *
 * The daemon has no reliable way to discover its own source commit at runtime:
 * the installed tree carries no `.git`, and the npm version alone cannot
 * distinguish two builds of the same release. The build system therefore
 * stamps the commit into the environment (see `nix/package.nix`, which bakes
 * these into the `paseo-server` wrapper). Builds produced without that
 * stamping simply report no provenance.
 */
export const BUILD_COMMIT_ENV_VAR = "PASEO_BUILD_COMMIT";
export const BUILD_COMMIT_DATE_ENV_VAR = "PASEO_BUILD_COMMIT_DATE";
export const BUILD_COMMIT_MESSAGE_ENV_VAR = "PASEO_BUILD_COMMIT_MESSAGE";
export const BUILD_REPO_URL_ENV_VAR = "PASEO_BUILD_REPO_URL";

function readEnv(env: NodeJS.ProcessEnv, name: string): string | null {
  const value = env[name];
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function resolveBuildInfo(env: NodeJS.ProcessEnv = process.env): BuildInfo | null {
  const commit = readEnv(env, BUILD_COMMIT_ENV_VAR);
  if (!commit) {
    // Without a commit there is nothing to link to; a bare date or repo URL
    // would be worse than reporting nothing.
    return null;
  }

  return {
    commit,
    commitDate: readEnv(env, BUILD_COMMIT_DATE_ENV_VAR),
    commitMessage: readEnv(env, BUILD_COMMIT_MESSAGE_ENV_VAR),
    repoUrl: readEnv(env, BUILD_REPO_URL_ENV_VAR),
  };
}

let cached: BuildInfo | null | undefined;

/** Process-wide provenance, resolved once from the environment at first use. */
export function getBuildInfo(): BuildInfo | null {
  if (cached === undefined) {
    cached = resolveBuildInfo();
  }
  return cached;
}

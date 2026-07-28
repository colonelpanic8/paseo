import type { BuildInfo } from "@getpaseo/protocol/messages";

/**
 * Repository a commit is assumed to live in when a build reports none. Forks
 * that publish their own assembled branches stamp their own URL at build time
 * (see `nix/package.nix`); only stock builds fall back to this.
 */
export const DEFAULT_REPO_URL = "https://github.com/getpaseo/paseo";

/** Enough of a SHA to be unambiguous in practice, short enough to read. */
const SHORT_COMMIT_LENGTH = 9;

export interface ResolvedBuildInfo {
  commit: string;
  shortCommit: string;
  commitDate: Date | null;
  commitUrl: string;
}

function trimmedOrNull(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * `https://github.com/owner/repo.git/` and `https://github.com/owner/repo`
 * must produce the same commit URL, so normalize both away.
 */
function normalizeRepoUrl(value: string): string {
  return value.replace(/\/+$/, "").replace(/\.git$/, "");
}

function parseCommitDate(value: unknown): Date | null {
  const raw = trimmedOrNull(value);
  if (!raw) {
    return null;
  }
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Turn the raw provenance a build (or a connected daemon) reports into
 * something renderable, or null when there is no commit to point at.
 */
export function resolveBuildInfo(info: BuildInfo | null | undefined): ResolvedBuildInfo | null {
  const commit = trimmedOrNull(info?.commit);
  if (!commit) {
    return null;
  }

  const repoUrl = normalizeRepoUrl(trimmedOrNull(info?.repoUrl) ?? DEFAULT_REPO_URL);

  return {
    commit,
    shortCommit: commit.slice(0, SHORT_COMMIT_LENGTH),
    commitDate: parseCommitDate(info?.commitDate),
    commitUrl: `${repoUrl}/commit/${commit}`,
  };
}

export function formatCommitDate(date: Date | null, locale?: string): string | null {
  if (!date) {
    return null;
  }
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

/**
 * The one-line stamp shown under a version: `a1b2c3d4e - Jul 28, 2026, 12:34 PM`,
 * degrading to just the commit when the build reported no date.
 */
export function formatBuildStamp(build: ResolvedBuildInfo, locale?: string): string {
  const date = formatCommitDate(build.commitDate, locale);
  return date ? `${build.shortCommit} · ${date}` : build.shortCommit;
}

/**
 * Provenance for the running client bundle.
 *
 * Expo inlines `process.env.EXPO_PUBLIC_*` at bundle time, so these must be
 * written out as complete member expressions — destructuring `process.env` or
 * indexing it dynamically defeats the transform and yields `undefined`.
 */
export function resolveClientBuildInfo(): ResolvedBuildInfo | null {
  return resolveBuildInfo({
    commit: process.env.EXPO_PUBLIC_PASEO_BUILD_COMMIT ?? "",
    commitDate: process.env.EXPO_PUBLIC_PASEO_BUILD_COMMIT_DATE ?? null,
    repoUrl: process.env.EXPO_PUBLIC_PASEO_BUILD_REPO_URL ?? null,
  });
}

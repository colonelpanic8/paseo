/**
 * Derives the `owner/repo` slug from a git remote URL.
 *
 * Handles the three forms git remotes actually ship in:
 * - scp-like SSH: `git@host:owner/repo.git`
 * - HTTPS: `https://host/owner/repo(.git)`
 * - SSH URL: `ssh://git@host/owner/repo(.git)`
 *
 * The trailing `.git` is stripped and the last two path segments are kept, so
 * nested namespaces (GitLab subgroups) collapse to `subgroup/repo`. Remotes with
 * fewer than two segments have no meaningful slug and return null.
 *
 * Parsing mirrors `deriveRemoteProjectKey` in ./agent-grouping.
 */
export function deriveRemoteSlug(remoteUrl: string | null): string | null {
  if (!remoteUrl) {
    return null;
  }

  const trimmed = remoteUrl.trim();
  if (!trimmed) {
    return null;
  }

  let path: string | null = null;

  // SSH scp-like form: user@host:owner/repo(.git)
  const scpLike = trimmed.match(/^[^@]+@([^:]+):(.+)$/);
  if (scpLike) {
    path = scpLike[2] ?? null;
  } else if (trimmed.includes("://")) {
    try {
      path = new URL(trimmed).pathname;
    } catch {
      return null;
    }
  }

  if (!path) {
    return null;
  }

  let cleanedPath = path.trim();
  if (cleanedPath.endsWith(".git")) {
    cleanedPath = cleanedPath.slice(0, -4);
  }

  const segments = cleanedPath.split("/").filter((segment) => segment.length > 0);
  if (segments.length < 2) {
    return null;
  }

  return segments.slice(-2).join("/");
}

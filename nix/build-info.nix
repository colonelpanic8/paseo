# Build provenance plumbing: how a build learns which commit produced it.
#
# Nothing can discover this at runtime. The installed tree carries no `.git`,
# and the npm version does not identify a build — many builds share a version.
# So the flake passes the commit down (see flake.nix) and this stamps it where
# each consumer looks for it:
#
#   * the daemon reads the environment, baked into its wrapper
#     (packages/server/src/server/build-info.ts)
#   * the client bundle reads `EXPO_PUBLIC_*`, which `expo export` inlines
#     into the bundle at build time (packages/app/src/utils/build-info.ts)
{ lib }:
{
  buildCommit ? null,
  buildCommitDate ? null,
  # The commit's subject line. A flake cannot see this (`self` exposes only
  # the rev), so flake-driven builds leave it unset; builders that run next to
  # a real checkout (e.g. the F-Droid pipeline) pass it explicitly.
  buildCommitMessage ? null,
  buildRepoUrl ? null,
}:
let
  isSet = value: value != null && value != "";

  # Without a commit there is nothing to link to, and a bare date or repo URL
  # would be worse than reporting no provenance at all — so it is all or none.
  stamped =
    if !isSet buildCommit then
      { }
    else
      lib.filterAttrs (_: isSet) {
        PASEO_BUILD_COMMIT = buildCommit;
        PASEO_BUILD_COMMIT_DATE = buildCommitDate;
        PASEO_BUILD_COMMIT_MESSAGE = buildCommitMessage;
        PASEO_BUILD_REPO_URL = buildRepoUrl;
      };
in
{
  # Merge into a derivation's `env` so `expo export` sees it.
  expoPublicEnv = lib.mapAttrs' (name: lib.nameValuePair "EXPO_PUBLIC_${name}") stamped;

  # Splice into a makeWrapper invocation via `lib.escapeShellArgs`.
  wrapperArgs = lib.concatLists (
    lib.mapAttrsToList (name: value: [
      "--set"
      name
      value
    ]) stamped
  );
}

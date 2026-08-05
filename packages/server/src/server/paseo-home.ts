import { resolvePaseoPaths } from "./paseo-paths.js";
import { ensurePrivateDirectory } from "./private-files.js";

/**
 * The historical single-root accessor, kept so unclassified call sites keep working. Under the
 * flat layout this is the same directory it always was; under XDG it is the data root.
 * Prefer `resolvePaseoPaths` and name the category the file actually belongs to.
 *
 * Creating the directory stays here rather than in the resolver: callers have always been able to
 * assume this one exists, while resolving a path should not be what brings a directory into being.
 */
export function resolvePaseoHome(env: NodeJS.ProcessEnv = process.env): string {
  const home = resolvePaseoPaths(env).home;
  ensurePrivateDirectory(home);
  return home;
}

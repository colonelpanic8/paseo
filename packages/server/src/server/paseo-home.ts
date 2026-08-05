import { resolvePaseoPaths } from "./paseo-paths.js";
import os from "node:os";

/**
 * The historical single-root accessor, kept so unclassified call sites keep working. Under the
 * flat layout this is the same directory it always was; under XDG it is the data root.
 * Prefer `resolvePaseoPaths` and name the category the file actually belongs to.
 */
export function resolvePaseoHome(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  homeDirectory: string = os.homedir(),
): string {
  return resolvePaseoPaths(env, platform, homeDirectory).home;
}

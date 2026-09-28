import { z } from "zod";

/**
 * The ten identity colors clients draw hosts, projects, and profiles in. Order is load-bearing:
 * clients derive a default color by indexing into this array, so reordering silently recolors
 * every host and project that never chose one.
 */
export const IDENTITY_COLOR_NAMES = [
  "violet",
  "sky",
  "emerald",
  "orange",
  "pink",
  "indigo",
  "teal",
  "red",
  "amber",
  "blue",
] as const;

export const IdentityColorNameSchema = z.enum(IDENTITY_COLOR_NAMES);

export type IdentityColorName = z.infer<typeof IdentityColorNameSchema>;

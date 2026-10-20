import { z } from "zod";

export const MANAGED_HOST_COLOR_KEYS = [
  "blue",
  "green",
  "amber",
  "orange",
  "red",
  "purple",
] as const;

export const ManagedHostSchema = z.object({
  label: z.string().trim().min(1),
  endpoint: z.string().trim().min(1),
  useTls: z.boolean().default(false),
  password: z.string().min(1).optional(),
  color: z.enum(MANAGED_HOST_COLOR_KEYS).optional(),
});

export const ManagedHostRegistrySchema = z.object({
  version: z.literal(1),
  hosts: z.array(ManagedHostSchema),
});

export type ManagedHost = z.infer<typeof ManagedHostSchema>;
export type ManagedHostRegistry = z.infer<typeof ManagedHostRegistrySchema>;

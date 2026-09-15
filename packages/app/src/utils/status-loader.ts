export type StatusLoaderBucket =
  | "needs_input"
  | "failed"
  | "running"
  | "attention"
  | "done"
  | "snoozed";

export function shouldRenderSyncedStatusLoader(input: {
  bucket: StatusLoaderBucket | null | undefined;
}): boolean {
  return input.bucket === "running";
}

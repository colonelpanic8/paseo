export function hasClearableWorkspaceAttention(input: {
  workspaceStatus: "needs_input" | "failed" | "running" | "attention" | "done" | undefined;
  readyToReview: boolean;
}): boolean {
  return (
    input.workspaceStatus === "attention" ||
    input.workspaceStatus === "failed" ||
    input.readyToReview
  );
}

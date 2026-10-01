import { resolve } from "node:path";
import type { PersistedWorkspaceRecord, WorkspaceRegistry } from "./workspace-registry.js";

const operationsByRegistry = new WeakMap<object, Map<string, Promise<void>>>();

// Restore must wait for an automatic archive to finish removing the backing
// directory. Different workspace records can own the same backing directory.
export async function withWorkspaceLifecycle<T>(
  input: {
    registry: Pick<WorkspaceRegistry, "get">;
    workspace: Pick<PersistedWorkspaceRecord, "cwd" | "worktreeRoot">;
  },
  operation: () => Promise<T>,
): Promise<T> {
  let operations = operationsByRegistry.get(input.registry);
  if (!operations) {
    operations = new Map();
    operationsByRegistry.set(input.registry, operations);
  }
  const directory = resolve(input.workspace.worktreeRoot ?? input.workspace.cwd);
  const previous = operations.get(directory);
  let release!: () => void;
  const pending = new Promise<void>((resolvePending) => {
    release = resolvePending;
  });
  operations.set(directory, pending);
  await previous;
  try {
    return await operation();
  } finally {
    release();
    if (operations.get(directory) === pending) operations.delete(directory);
  }
}

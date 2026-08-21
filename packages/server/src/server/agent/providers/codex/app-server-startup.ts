const CODEX_SQLITE_INITIALIZATION_ERROR = "failed to initialize sqlite state runtime";
const CODEX_APP_SERVER_STARTUP_ATTEMPTS = 3;

let startupQueue: Promise<void> = Promise.resolve();

interface CodexAppServerStartupOptions<T> {
  start: (attempt: number) => Promise<T>;
  signal?: AbortSignal;
  onRetry?: (error: unknown, nextAttempt: number, maxAttempts: number) => void;
}

function isCodexSqliteInitializationError(error: unknown): boolean {
  return error instanceof Error && error.message.includes(CODEX_SQLITE_INITIALIZATION_ERROR);
}

function serializeStartup<T>(start: () => Promise<T>): Promise<T> {
  const next = startupQueue.then(start, start);
  startupQueue = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

export function runCodexAppServerStartup<T>(options: CodexAppServerStartupOptions<T>): Promise<T> {
  return serializeStartup(async () => {
    for (let attempt = 1; attempt <= CODEX_APP_SERVER_STARTUP_ATTEMPTS; attempt += 1) {
      options.signal?.throwIfAborted();
      try {
        return await options.start(attempt);
      } catch (error) {
        const canRetry =
          attempt < CODEX_APP_SERVER_STARTUP_ATTEMPTS && isCodexSqliteInitializationError(error);
        if (!canRetry) {
          throw error;
        }
        options.onRetry?.(error, attempt + 1, CODEX_APP_SERVER_STARTUP_ATTEMPTS);
      }
    }
    throw new Error("Codex app-server startup exhausted without a result");
  });
}

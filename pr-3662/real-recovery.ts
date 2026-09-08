import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdirSync } from "node:fs";

const initializeParams = {
  clientInfo: { name: "paseo", title: "Paseo", version: "0.1.0" },
  capabilities: { experimentalApi: true, mcpServerOpenaiFormElicitation: true },
};

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

async function main() {
  const sourceRoot = process.env.PASEO_EVIDENCE_SOURCE_ROOT;
  const codexHome = process.env.CODEX_HOME;
  const codexScript = process.env.PASEO_EVIDENCE_CODEX_SCRIPT;
  const scenario = process.env.PASEO_EVIDENCE_SCENARIO;
  if (!sourceRoot || !codexHome || !codexScript || !scenario) {
    throw new Error(
      "PASEO_EVIDENCE_SOURCE_ROOT, PASEO_EVIDENCE_CODEX_SCRIPT, PASEO_EVIDENCE_SCENARIO, and CODEX_HOME are required",
    );
  }
  mkdirSync(codexHome, { recursive: true });

  const [{ runCodexAppServerStartup }, { CodexAppServerClient }, { createTestLogger }] =
    await Promise.all([
      import(
        `${sourceRoot}/packages/server/src/server/agent/providers/codex/app-server-startup.ts`
      ),
      import(
        `${sourceRoot}/packages/server/src/server/agent/providers/codex/app-server-transport.ts`
      ),
      import(`${sourceRoot}/packages/server/src/test-utils/test-logger.ts`),
    ]);

  const logger = createTestLogger();
  const startedAt = performance.now();
  const events: Array<Record<string, unknown>> = [];
  const children = new Set<ChildProcessWithoutNullStreams>();

  function event(type: string, details: Record<string, unknown> = {}) {
    events.push({ ms: Number((performance.now() - startedAt).toFixed(1)), type, ...details });
  }

  function spawnReal(label: string) {
    const child = spawn(codexScript, ["app-server"], {
      env: { ...process.env, CODEX_HOME: codexHome },
      stdio: ["pipe", "pipe", "pipe"],
    });
    children.add(child);
    event("process-spawned", { label, pid: child.pid });
    child.once("exit", (code, signal) => {
      children.delete(child);
      event("process-exited", { label, pid: child.pid, code, signal });
    });
    return { child, client: new CodexAppServerClient(child, logger) };
  }

  async function healthyStart(label: string) {
    const { child, client } = spawnReal(label);
    event("initialize-started", { label, pid: child.pid });
    await client.request("initialize", initializeParams, 10_000);
    event("initialize-succeeded", { label, pid: child.pid });
    client.notify("initialized", {});
    return client;
  }

  async function finishHealthy(label: string, promise: Promise<unknown>) {
    const client = await promise;
    const response = (await client.request("thread/list", { limit: 1 }, 10_000)) as {
      data?: unknown[];
    };
    event("thread-list-succeeded", { label, count: response.data?.length ?? 0 });
    await client.dispose();
    return "succeeded";
  }

  event("scenario-started", {
    scenario,
    sourceSha: process.env.PASEO_EVIDENCE_SHA,
    codexVersion: process.env.PASEO_EVIDENCE_CODEX_VERSION,
    codexHome,
  });

  let results: PromiseSettledResult<unknown>[];

  if (scenario === "legacy-stall") {
    const firstSpawned = deferred();
    let stalledChild: ChildProcessWithoutNullStreams | undefined;
    let secondStarted = false;
    const first = runCodexAppServerStartup({
      start: async () => {
        const { child, client } = spawnReal("stalled-first");
        stalledChild = child;
        child.kill("SIGSTOP");
        event("process-stopped", { label: "stalled-first", pid: child.pid });
        firstSpawned.resolve();
        try {
          event("initialize-started", { label: "stalled-first", pid: child.pid });
          await client.request("initialize", initializeParams, 45_000);
          return client;
        } catch (error) {
          await client.dispose();
          throw error;
        }
      },
    });
    await firstSpawned.promise;
    const second = runCodexAppServerStartup({
      start: async () => {
        secondStarted = true;
        return await healthyStart("queued-second");
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    event("queue-observed", { waitMs: 1_500, secondStarted });
    stalledChild?.kill("SIGKILL");
    event("manual-cleanup-sent", { label: "stalled-first", pid: stalledChild?.pid });
    results = await Promise.allSettled([first, finishHealthy("queued-second", second)]);
  } else if (scenario === "final-stall") {
    const firstSpawned = deferred();
    let startupClient: InstanceType<typeof CodexAppServerClient> | undefined;
    const timeoutOverride = process.env.PASEO_EVIDENCE_TIMEOUT_MS;
    const first = runCodexAppServerStartup({
      ...(timeoutOverride ? { timeoutMs: Number(timeoutOverride) } : {}),
      start: async (_attempt: number, signal: AbortSignal) => {
        const { child, client } = spawnReal("stalled-first");
        startupClient = client;
        child.kill("SIGSTOP");
        event("process-stopped", { label: "stalled-first", pid: child.pid });
        firstSpawned.resolve();
        try {
          signal.throwIfAborted();
          event("initialize-started", { label: "stalled-first", pid: child.pid });
          await client.request("initialize", initializeParams, 45_000);
          return client;
        } catch (error) {
          await client.dispose();
          throw error;
        } finally {
          if (startupClient === client) startupClient = undefined;
        }
      },
      onAbort: async () => {
        event("timeout-cleanup-started");
        await startupClient?.dispose();
        event("timeout-cleanup-finished");
      },
    });
    await firstSpawned.promise;
    let secondStarted = false;
    const second = runCodexAppServerStartup({
      start: async () => {
        secondStarted = true;
        return await healthyStart("queued-second");
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    event("queue-observed", { waitMs: 1_500, secondStarted });
    results = await Promise.allSettled([first, finishHealthy("queued-second", second)]);
  } else if (scenario === "final-failure") {
    const firstSpawned = deferred();
    const first = runCodexAppServerStartup({
      start: async () => {
        const { child, client } = spawnReal("failed-first");
        event("initialize-started", { label: "failed-first", pid: child.pid });
        const initialize = client.request("initialize", initializeParams, 10_000);
        child.kill("SIGKILL");
        event("forced-process-failure", { label: "failed-first", pid: child.pid });
        firstSpawned.resolve();
        try {
          await initialize;
          return client;
        } catch (error) {
          await client.dispose();
          throw error;
        }
      },
    });
    await firstSpawned.promise;
    const second = runCodexAppServerStartup({
      start: async () => await healthyStart("queued-second"),
    });
    results = await Promise.allSettled([first, finishHealthy("queued-second", second)]);
  } else {
    throw new Error(`Unknown scenario: ${scenario}`);
  }

  for (const child of children) child.kill("SIGKILL");

  const summarizedResults = results.map((result) =>
    result.status === "fulfilled"
      ? { status: "fulfilled", value: result.value }
      : {
          status: "rejected",
          error: result.reason instanceof Error ? result.reason.message : String(result.reason),
        },
  );
  console.log(
    JSON.stringify(
      {
        scenario,
        sourceSha: process.env.PASEO_EVIDENCE_SHA,
        codexVersion: process.env.PASEO_EVIDENCE_CODEX_VERSION,
        codexHome,
        elapsedMs: Number((performance.now() - startedAt).toFixed(1)),
        results: summarizedResults,
        events,
      },
      null,
      2,
    ),
  );
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

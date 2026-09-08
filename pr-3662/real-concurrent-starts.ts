import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";

async function main() {
const sourceRoot = process.env.PASEO_EVIDENCE_SOURCE_ROOT;
const codexHome = process.env.CODEX_HOME;
const codexScript = process.env.PASEO_EVIDENCE_CODEX_SCRIPT;
const count = Number(process.env.PASEO_EVIDENCE_COUNT ?? "24");

if (!sourceRoot || !codexHome || !codexScript) {
  throw new Error(
    "PASEO_EVIDENCE_SOURCE_ROOT, PASEO_EVIDENCE_CODEX_SCRIPT, and CODEX_HOME are required",
  );
}

mkdirSync(codexHome, { recursive: true });

const [{ CodexAppServerAgentClient }, { CodexAppServerClient }, { createTestLogger }] =
  await Promise.all([
    import(`${sourceRoot}/packages/server/src/server/agent/providers/codex-app-server-agent.ts`),
    import(
      `${sourceRoot}/packages/server/src/server/agent/providers/codex/app-server-transport.ts`
    ),
    import(`${sourceRoot}/packages/server/src/test-utils/test-logger.ts`),
  ]);

const startedAt = performance.now();
const events: Array<Record<string, unknown>> = [];
let activeProcesses = 0;
let maxActiveProcesses = 0;
let activeInitializations = 0;
let maxActiveInitializations = 0;

function event(type: string, details: Record<string, unknown> = {}) {
  events.push({ ms: Number((performance.now() - startedAt).toFixed(1)), type, ...details });
}

function makeClient(index: number) {
  return new CodexAppServerAgentClient(
    createTestLogger(),
    {
      command: {
        mode: "replace",
        argv: [codexScript],
      },
    },
    {
      _createCodexClient: (child: ReturnType<typeof spawn>, logger: unknown) => {
        activeProcesses += 1;
        maxActiveProcesses = Math.max(maxActiveProcesses, activeProcesses);
        event("process-spawned", { index, pid: child.pid, activeProcesses });
        child.once("exit", (code, signal) => {
          activeProcesses -= 1;
          event("process-exited", { index, pid: child.pid, code, signal, activeProcesses });
        });

        const transport = new CodexAppServerClient(child, logger);
        return {
          request: async (method: string, params?: unknown) => {
            if (method !== "initialize") {
              return await transport.request(method, params, 20_000);
            }
            activeInitializations += 1;
            maxActiveInitializations = Math.max(
              maxActiveInitializations,
              activeInitializations,
            );
            event("initialize-started", { index, pid: child.pid, activeInitializations });
            try {
              const result = await transport.request(method, params, 20_000);
              event("initialize-succeeded", { index, pid: child.pid });
              return result;
            } catch (error) {
              event("initialize-failed", {
                index,
                pid: child.pid,
                error: error instanceof Error ? error.message : String(error),
              });
              throw error;
            } finally {
              activeInitializations -= 1;
            }
          },
          notify: (method: string, params?: unknown) => transport.notify(method, params),
          dispose: async () => await transport.dispose(),
        };
      },
    },
  );
}

event("scenario-started", { count, codexHome });
const results = await Promise.allSettled(
  Array.from({ length: count }, (_, index) => {
    event("caller-started", { index });
    return makeClient(index)
      .listImportableSessions({ limit: 1 })
      .then((sessions: unknown[]) => {
        event("caller-succeeded", { index, sessions: sessions.length });
        return sessions.length;
      });
  }),
);

const failures = results.flatMap((result, index) =>
  result.status === "rejected"
    ? [{ index, error: result.reason instanceof Error ? result.reason.message : String(result.reason) }]
    : [],
);

const report = {
  sourceSha: process.env.PASEO_EVIDENCE_SHA,
  codexVersion: process.env.PASEO_EVIDENCE_CODEX_VERSION,
  codexHome,
  requestedStarts: count,
  succeeded: results.length - failures.length,
  failed: failures.length,
  sqliteInitializationFailures: failures.filter((failure) =>
    failure.error.includes("failed to initialize sqlite state runtime"),
  ).length,
  maxActiveProcesses,
  maxActiveInitializations,
  elapsedMs: Number((performance.now() - startedAt).toFixed(1)),
  failures,
  events,
};

console.log(JSON.stringify(report, null, 2));
process.exitCode = failures.length === 0 ? 0 : 1;
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

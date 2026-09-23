import { z } from "zod";
import { createAgentPreferencesService } from "@/create-agent-preferences/service";
import { androidIntents } from "@/native/android-intents";
import { getHostRuntimeStore, isHostRuntimeConnected } from "@/runtime/host-runtime";
import { useSessionStore } from "@/stores/session-store";
import { fetchAgentTimelineOnce } from "@/timeline/fetch-agent-timeline-once";
import { assistantNoticeRow } from "./assistant-messages";
import {
  parseAssistantQueryRequest,
  runAssistantQuery,
  type AssistantQueryFetch,
  type AssistantQueryHost,
  type AssistantQueryRequest,
} from "./assistant-query";
import {
  parseAssistantRequestJob,
  runAssistantRequest,
  type AssistantHostConnection,
} from "./assistant-requests";

export const ASSISTANT_TASK_KEY = "PaseoAssistantTask";

// The provider parks its binder thread for 17 seconds; a cold start spends
// part of that loading JavaScript.
const QUERY_CONNECT_TIMEOUT_MS = 8_000;
const QUERY_DIRECTORY_TIMEOUT_MS = 4_000;
const QUERY_FETCH_TIMEOUT_MS = 5_000;
const MAX_FETCH_ITEMS = 60;
const REQUEST_CONNECT_TIMEOUT_MS = 15_000;
// Headless tasks are cut off at 90 seconds; stop waiting before that and
// leave the request pending for a status poll to resume.
const REQUEST_DISPATCH_TIMEOUT_MS = 60_000;

const TaskDataSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("messages"), requestId: z.string().min(1), params: z.string() }),
  z.object({ kind: z.literal("request"), key: z.string().min(1) }).passthrough(),
]);

/**
 * Waits for the runtime to connect to one host. In a cold headless start the
 * registry loads from storage and the host controllers dial out on their own;
 * this only waits for that, bounded.
 */
export async function connectAssistantHost(
  serverId: string,
  timeoutMs: number,
): Promise<AssistantHostConnection> {
  const store = getHostRuntimeStore();
  await store.boot();
  if (!store.getHosts().some((host) => host.serverId === serverId)) {
    return { kind: "unknown_host" };
  }
  const current = () => {
    const client = store.getClient(serverId);
    return client && isHostRuntimeConnected(store.getSnapshot(serverId)) ? client : null;
  };
  const ready = current();
  if (ready) return { kind: "connected", client: ready };

  let timer: ReturnType<typeof setTimeout> | undefined;
  let unsubscribe = () => {};
  try {
    await new Promise<void>((resolve) => {
      timer = setTimeout(resolve, timeoutMs);
      unsubscribe = store.subscribe(serverId, () => {
        if (current()) resolve();
      });
      void store.runProbeCycleNow(serverId).catch(() => undefined);
    });
  } finally {
    clearTimeout(timer);
    unsubscribe();
  }
  const client = current();
  return client ? { kind: "connected", client } : { kind: "offline" };
}

function collectHosts(): AssistantQueryHost[] {
  const runtime = getHostRuntimeStore();
  const labels = new Map(runtime.getHosts().map((host) => [host.serverId, host.label]));
  return Object.values(useSessionStore.getState().sessions).map((session) => {
    const agents = [...session.agents.values()];
    const agentWorkspaceIds = agents.flatMap((agent) =>
      agent.workspaceId ? [agent.workspaceId] : [],
    );
    return {
      serverId: session.serverId,
      label: labels.get(session.serverId) ?? session.serverId,
      connected: isHostRuntimeConnected(runtime.getSnapshot(session.serverId)),
      workspaceIds: new Set([...session.workspaces.keys(), ...agentWorkspaceIds]),
      agents,
    };
  });
}

const fetchEntries: AssistantQueryFetch = async (target, limit) => {
  const client = getHostRuntimeStore().getClient(target.serverId);
  if (!client) {
    throw new Error(`Host ${target.serverId} has no client`);
  }
  const page = await fetchAgentTimelineOnce(client, target.agentId, {
    direction: "tail",
    projection: "projected",
    limit: Math.min(limit * 3, MAX_FETCH_ITEMS),
    timeout: QUERY_FETCH_TIMEOUT_MS,
  });
  return page.entries;
};

/**
 * Loads what the query needs into the runtime's directory. A warm app usually
 * has it already; a cold headless start has nothing until the hosts connect.
 */
async function hydrateForQuery(request: AssistantQueryRequest): Promise<void> {
  const store = getHostRuntimeStore();
  await store.boot();
  const serverIds = request.serverId
    ? [request.serverId]
    : store.getHosts().map((host) => host.serverId);
  await Promise.all(
    serverIds.map(async (serverId) => {
      const connection = await connectAssistantHost(serverId, QUERY_CONNECT_TIMEOUT_MS);
      if (connection.kind !== "connected") return;
      // Route preparation only reads the local cache, which a cold start may
      // not have. The workspace refresh waits for server info that only the
      // mounted session context records, so read agents alone; their
      // workspace ids identify the workspaces (see collectHosts).
      const release = store.acquireDirectoryDemand(serverId);
      try {
        await Promise.race([
          store.refreshAgentDirectory({ serverId }).catch(() => undefined),
          new Promise((resolve) => setTimeout(resolve, QUERY_DIRECTORY_TIMEOUT_MS)),
        ]);
      } finally {
        release();
      }
    }),
  );
}

async function answerQuery(request: AssistantQueryRequest): Promise<void> {
  let rows;
  try {
    await hydrateForQuery(request);
    rows = await runAssistantQuery({ request, hosts: collectHosts(), fetchEntries });
  } catch {
    rows = [
      assistantNoticeRow({
        text: "Paseo could not read that conversation; try again in a moment.",
        serverId: request.serverId,
        agentId: request.agentId,
        workspaceId: request.workspaceId,
      }),
    ];
  }
  androidIntents.resolveAssistantQuery(request.requestId, JSON.stringify({ rows }));
}

async function runRequest(raw: unknown): Promise<void> {
  const job = parseAssistantRequestJob(raw);
  if (!job) return;
  try {
    await runAssistantRequest(job, {
      connect: (serverId) => connectAssistantHost(serverId, REQUEST_CONNECT_TIMEOUT_MS),
      loadFormPreferences: () => createAgentPreferencesService.load(),
      report: (update) => androidIntents.reportAssistantRequest(job.key, JSON.stringify(update)),
      dispatchTimeoutMs: REQUEST_DISPATCH_TIMEOUT_MS,
    });
  } finally {
    androidIntents.finishAssistantRequest(job.key);
  }
}

/**
 * Headless JS task native code starts for assistant work. It runs whether or
 * not any screen is mounted, so it must not depend on React state.
 */
export async function runAssistantTask(data: unknown): Promise<void> {
  const task = TaskDataSchema.safeParse(data);
  if (!task.success) return;
  if (task.data.kind === "request") {
    await runRequest(task.data);
    return;
  }
  let params: unknown;
  try {
    params = JSON.parse(task.data.params);
  } catch {
    return;
  }
  const request = parseAssistantQueryRequest({
    ...(params as object),
    requestId: task.data.requestId,
  });
  if (request) await answerQuery(request);
}

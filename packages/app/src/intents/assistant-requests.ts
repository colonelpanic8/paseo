import { z } from "zod";
import { createNameId } from "mnemonic-id";
import {
  DaemonConnectionError,
  type CreateWorkspaceRequestOptions,
  type DaemonClient,
  type SendMessageOptions,
} from "@getpaseo/client/internal/daemon-client";
import type { CreationSnapshot } from "@getpaseo/protocol/messages";
import type { FormPreferences } from "@/create-agent-preferences/preferences";
import { canCreateWorktreeForProjectKind } from "@/projects/host-project-model";
import {
  defaultBasePickerItem,
  pickerItemToCheckoutRequest,
} from "@/screens/new-workspace-picker-item";

// States the native journal stores. See ReceiptState in the native module.
export type AssistantRequestState =
  | "accepted"
  | "waiting_for_host"
  | "submitted"
  | "completed"
  | "failed"
  | "uncertain"
  | "rejected"
  | "needs_configuration"
  | "needs_host_update";

export interface AssistantRequestUpdate {
  state?: AssistantRequestState;
  dispatchStarted?: boolean;
  plan?: AssistantRequestPlan;
  workspaceId?: string;
  agentId?: string;
  error?: { code: string; message: string };
}

export type AssistantHostClient = Pick<
  DaemonClient,
  | "getLastServerInfoMessage"
  | "listProjects"
  | "getProvidersSnapshot"
  | "getCheckoutStatus"
  | "createWorkspace"
  | "fetchAgent"
  | "sendAgentMessage"
>;

export type AssistantHostConnection =
  | { kind: "connected"; client: AssistantHostClient }
  | { kind: "unknown_host" }
  | { kind: "offline" };

export interface AssistantRequestDeps {
  connect: (serverId: string) => Promise<AssistantHostConnection>;
  loadFormPreferences: () => Promise<FormPreferences>;
  /** Resolves with the stored request once the native journal has committed the update. */
  report: (update: AssistantRequestUpdate) => Promise<unknown>;
  /** How long to wait for the daemon before leaving the request pending. */
  dispatchTimeoutMs: number;
}

const MAX_ERROR_MESSAGE = 500;

const CreateAgentArgumentsSchema = z.object({
  serverId: z.string().min(1),
  projectId: z.string().min(1),
  prompt: z.string().min(1).max(16_000),
  isolation: z.enum(["local", "worktree"]),
  worktreeMode: z.enum(["branch-off", "checkout-branch", "checkout-pr"]).optional(),
  baseRef: z.string().min(1).optional(),
  branch: z.string().min(1).optional(),
  prNumber: z.number().int().positive().optional(),
  forge: z.string().min(1).optional(),
  worktreeSlug: z.string().min(1).optional(),
  provider: z.string().min(1).optional(),
  model: z.string().min(1).optional(),
  modeId: z.string().min(1).optional(),
  thinkingOptionId: z.string().min(1).optional(),
  title: z.string().min(1).optional(),
});
type CreateAgentArguments = z.infer<typeof CreateAgentArgumentsSchema>;

const SendPromptArgumentsSchema = z.object({
  serverId: z.string().min(1),
  agentId: z.string().min(1),
  prompt: z.string().min(1).max(16_000),
  activeTurnBehavior: z.enum(["steer", "interrupt"]).optional(),
});

const CreateAgentPlanSchema = z.object({
  kind: z.literal("create_agent"),
  request: z.record(z.string(), z.unknown()),
});
const SendPromptPlanSchema = z.object({
  kind: z.literal("send_prompt"),
  agentId: z.string().min(1),
  text: z.string().min(1),
  messageId: z.string().min(1),
  activeTurnBehavior: z.enum(["steer", "interrupt"]),
});
const PlanSchema = z.discriminatedUnion("kind", [CreateAgentPlanSchema, SendPromptPlanSchema]);
export type AssistantRequestPlan = z.infer<typeof PlanSchema>;

const PENDING_STATES = new Set(["accepted", "waiting_for_host", "submitted"]);
const StoredRequestSchema = z.object({ state: z.string(), plan: PlanSchema });

const JobSchema = z.object({
  key: z.string().min(1),
  operation: z.enum(["create_agent", "send_prompt"]),
  arguments: z.string(),
  plan: z.string(),
  dispatchStarted: z.enum(["true", "false"]),
});

export interface AssistantRequestJob {
  key: string;
  operation: "create_agent" | "send_prompt";
  arguments: unknown;
  plan: AssistantRequestPlan | null;
  dispatchStarted: boolean;
}

/** Parses the task data native code hands over; anything malformed is dropped whole. */
export function parseAssistantRequestJob(raw: unknown): AssistantRequestJob | null {
  const job = JobSchema.safeParse(raw);
  if (!job.success) return null;
  try {
    const plan = job.data.plan ? PlanSchema.safeParse(JSON.parse(job.data.plan)) : null;
    if (plan && !plan.success) return null;
    return {
      key: job.data.key,
      operation: job.data.operation,
      arguments: JSON.parse(job.data.arguments),
      plan: plan?.data ?? null,
      dispatchStarted: job.data.dispatchStarted === "true",
    };
  } catch {
    return null;
  }
}

/** Stable daemon identities derived from the journal key, so every replay dedupes. */
export function assistantIdempotencyKey(key: string): string {
  return `assistant:${key}`;
}

class Outcome extends Error {
  constructor(readonly update: AssistantRequestUpdate) {
    super(update.error?.message ?? update.state ?? "outcome");
  }
}

function stop(state: AssistantRequestState, code: string, message: string): Outcome {
  return new Outcome({ state, error: { code, message: clip(message) } });
}

function clip(message: string): string {
  const chars = Array.from(message);
  return chars.length > MAX_ERROR_MESSAGE ? chars.slice(0, MAX_ERROR_MESSAGE).join("") : message;
}

function supports(client: AssistantHostClient, feature: string): boolean {
  const features = client.getLastServerInfoMessage()?.features as
    | Record<string, unknown>
    | undefined;
  return features?.[feature] === true;
}

function requireFeatures(client: AssistantHostClient, features: string[]): void {
  const missing = features.filter((feature) => !supports(client, feature));
  if (missing.length > 0) {
    throw stop(
      "needs_host_update",
      "host_update_required",
      `The host does not support ${missing.join(", ")}.`,
    );
  }
}

async function connected(
  deps: AssistantRequestDeps,
  serverId: string,
): Promise<AssistantHostClient> {
  const connection = await deps.connect(serverId);
  if (connection.kind === "unknown_host") {
    throw stop("rejected", "unknown_host", "Paseo is not paired with that host.");
  }
  if (connection.kind === "offline") {
    throw stop("waiting_for_host", "host_offline", "The host is offline.");
  }
  return connection.client;
}

/**
 * Resolves defaults once, against the host's current registry, into the exact
 * daemon request. Nothing interactive is consulted: no remembered project or
 * host, and never a saved permission mode.
 */
export async function planCreateAgent(input: {
  key: string;
  args: CreateAgentArguments;
  client: AssistantHostClient;
  preferences: FormPreferences;
}): Promise<AssistantRequestPlan> {
  const { args, client } = input;
  requireFeatures(client, [
    "creationLifecycle",
    "workspaceRequestReceipts",
    ...(args.isolation === "local" ? ["workspaceMultiplicity"] : []),
  ]);

  const projects = await client.listProjects();
  const project = projects.projects.find((candidate) => candidate.projectId === args.projectId);
  if (!project) {
    throw stop("rejected", "unknown_project", "That project is not on this host.");
  }
  if (args.isolation === "worktree" && !canCreateWorktreeForProjectKind(project.projectKind)) {
    throw stop(
      "rejected",
      "worktree_unsupported",
      "Worktrees need a git project; use isolation=local.",
    );
  }

  const cwd = project.projectRootPath;
  const launch = await resolveLaunch(args, client, input.preferences, cwd);
  let source: CreateWorkspaceRequestOptions["source"];
  if (args.isolation === "local") {
    source = { kind: "directory", path: cwd, projectId: project.projectId };
  } else {
    source = {
      kind: "worktree",
      cwd,
      projectId: project.projectId,
      worktreeSlug: args.worktreeSlug ?? createNameId(),
      ...(await worktreeCheckout(args, client, cwd)),
    };
  }

  const idempotencyKey = assistantIdempotencyKey(input.key);
  const request: Omit<CreateWorkspaceRequestOptions, "onEvent"> = {
    idempotencyKey,
    source,
    ...(args.title ? { title: args.title } : {}),
    agent: {
      config: { ...launch, cwd },
      initialPrompt: args.prompt,
      clientMessageId: `${idempotencyKey}:initial-message`,
    },
    firstAgentContext: { prompt: args.prompt.trim(), attachments: [] },
  };
  return { kind: "create_agent", request };
}

const PROVIDER_LOADING_ATTEMPTS = 20;
const PROVIDER_LOADING_DELAY_MS = 250;

// The host answers the first snapshot for a directory with "loading" entries,
// which a cold headless start hits every time.
async function readProviderEntry(client: AssistantHostClient, provider: string, cwd: string) {
  for (let attempt = 1; ; attempt += 1) {
    const snapshot = await client.getProvidersSnapshot({ cwd });
    const entry = snapshot.entries.find((candidate) => candidate.provider === provider);
    if (entry?.status !== "loading" || attempt >= PROVIDER_LOADING_ATTEMPTS) return entry;
    await new Promise((resolve) => setTimeout(resolve, PROVIDER_LOADING_DELAY_MS));
  }
}

/** The host's first ready provider, in the order the host lists them. */
async function firstReadyProvider(client: AssistantHostClient, cwd: string) {
  for (let attempt = 1; ; attempt += 1) {
    const snapshot = await client.getProvidersSnapshot({ cwd });
    const ready = snapshot.entries.find(
      (entry) => entry.enabled !== false && entry.status === "ready",
    );
    const loading = snapshot.entries.some((entry) => entry.status === "loading");
    if (ready || !loading || attempt >= PROVIDER_LOADING_ATTEMPTS) return ready?.provider;
    await new Promise((resolve) => setTimeout(resolve, PROVIDER_LOADING_DELAY_MS));
  }
}

/**
 * Provider and model from the request, else the New workspace form's saved
 * choice, else the host's first ready provider; mode only from the request.
 */
async function resolveLaunch(
  args: CreateAgentArguments,
  client: AssistantHostClient,
  preferences: FormPreferences,
  cwd: string,
) {
  const provider = args.provider ?? preferences.provider ?? (await firstReadyProvider(client, cwd));
  if (!provider) {
    throw stop("needs_configuration", "provider_required", "No provider is ready on this host.");
  }
  const entry = await readProviderEntry(client, provider, cwd);
  if (!entry || entry.enabled === false) {
    throw stop("rejected", "unknown_provider", `Provider ${provider} is not enabled on this host.`);
  }
  if (entry.status !== "ready") {
    throw stop(
      "rejected",
      "provider_unavailable",
      `Provider ${provider} is ${entry.status} on this host.`,
    );
  }
  const offered = (id: string) => !entry.models || entry.models.some((model) => model.id === id);
  if (args.model && !offered(args.model)) {
    throw stop("rejected", "unknown_model", `Model ${args.model} is not offered by ${provider}.`);
  }
  if (args.modeId && entry.modes && !entry.modes.some((mode) => mode.id === args.modeId)) {
    throw stop("rejected", "unknown_mode", `Mode ${args.modeId} is not offered by ${provider}.`);
  }
  // A saved model the host dropped falls back to the provider default.
  const saved = preferences.providerPreferences?.[provider]?.model;
  const model = args.model ?? (saved && offered(saved) ? saved : undefined);
  return {
    provider,
    ...(args.modeId ? { modeId: args.modeId } : {}),
    ...(model ? { model } : {}),
    ...(args.thinkingOptionId ? { thinkingOptionId: args.thinkingOptionId } : {}),
  };
}

async function worktreeCheckout(
  args: CreateAgentArguments,
  client: AssistantHostClient,
  cwd: string,
) {
  const mode = args.worktreeMode ?? "branch-off";
  if (mode === "checkout-branch" && args.branch) {
    return { action: "checkout" as const, refName: args.branch };
  }
  if (mode === "checkout-pr" && args.prNumber) {
    const forge = args.forge ?? "github";
    return {
      action: "checkout" as const,
      checkoutSource: { kind: "change_request" as const, forge, number: args.prNumber },
      // COMPAT(githubPrNumber): mirrors pickerItemToCheckoutRequest for daemons
      // predating checkoutSource. Remove with that shim.
      ...(forge === "github" ? { githubPrNumber: args.prNumber } : {}),
    };
  }
  if (args.baseRef) {
    return { action: "branch-off" as const, refName: args.baseRef };
  }
  const status = await client.getCheckoutStatus(cwd);
  const request = pickerItemToCheckoutRequest(defaultBasePickerItem(status));
  if (!request) {
    throw stop(
      "rejected",
      "no_base_branch",
      "The project has no current branch to branch from; pass baseRef.",
    );
  }
  return request;
}

async function planSendPrompt(input: {
  key: string;
  args: z.infer<typeof SendPromptArgumentsSchema>;
  client: AssistantHostClient;
}): Promise<AssistantRequestPlan> {
  const { args, client } = input;
  requireFeatures(client, ["agentRequestReceipts"]);
  const found = await client.fetchAgent(args.agentId);
  if (!found) {
    throw stop("rejected", "unknown_agent", "That agent is not on this host.");
  }
  if (found.agent.archivedAt) {
    throw stop("rejected", "agent_archived", "That agent is archived.");
  }
  return {
    kind: "send_prompt",
    agentId: found.agent.id,
    text: args.prompt,
    messageId: `${assistantIdempotencyKey(input.key)}:message`,
    activeTurnBehavior: args.activeTurnBehavior ?? "steer",
  };
}

/** What a daemon creation snapshot proves. A prompt that started is delivered. */
export function updateFromCreationSnapshot(snapshot: CreationSnapshot): AssistantRequestUpdate {
  const ids = {
    ...(snapshot.workspaceId ? { workspaceId: snapshot.workspaceId } : {}),
    ...(snapshot.agentId ? { agentId: snapshot.agentId } : {}),
  };
  switch (snapshot.phase) {
    case "prompt_started":
    case "completed":
      return { state: "completed", ...ids };
    case "failed":
      return {
        state: snapshot.outcomeUnknown ? "uncertain" : "failed",
        ...ids,
        error: {
          code:
            snapshot.errorCode ??
            `${snapshot.failedStage ?? "creation"}_${snapshot.outcomeUnknown ? "outcome_unknown" : "failed"}`,
          message: clip(snapshot.error ?? "The host could not create the agent."),
        },
      };
    default:
      return { state: "submitted", ...ids };
  }
}

function isLostReply(error: unknown): boolean {
  return (
    error instanceof DaemonConnectionError ||
    (error instanceof Error && error.message.startsWith("Timeout waiting for message"))
  );
}

/** Errors that settle the request; anything else leaves it pending for a safe replay. */
function settledByError(error: unknown): AssistantRequestUpdate | null {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("request_outcome_unknown")) {
    return {
      state: "uncertain",
      error: {
        code: "outcome_unknown",
        message: "The host restarted while handling this request.",
      },
    };
  }
  if (message.includes("request_key_conflict")) {
    return {
      state: "failed",
      error: {
        code: "key_conflict",
        message: "The host already has a different request under this ID.",
      },
    };
  }
  return null;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T | typeof TIMED_OUT> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<typeof TIMED_OUT>((resolve) => {
    timer = setTimeout(() => resolve(TIMED_OUT), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
const TIMED_OUT = Symbol("timed out");

async function dispatchCreate(
  plan: Extract<AssistantRequestPlan, { kind: "create_agent" }>,
  client: AssistantHostClient,
  deps: AssistantRequestDeps,
  report: (update: AssistantRequestUpdate) => Promise<unknown>,
): Promise<void> {
  const request = plan.request as unknown as CreateWorkspaceRequestOptions;
  const result = await withTimeout(
    client.createWorkspace({
      ...request,
      onEvent: (snapshot) => {
        report(updateFromCreationSnapshot(snapshot)).catch(() => undefined);
      },
    }),
    deps.dispatchTimeoutMs,
  );
  if (result === TIMED_OUT) return;
  if (result.creation) {
    await report(updateFromCreationSnapshot(result.creation));
  } else if (result.error) {
    await report({
      state: "failed",
      error: { code: result.errorCode ?? "creation_failed", message: clip(result.error) },
    });
  }
}

async function dispatchSend(
  plan: Extract<AssistantRequestPlan, { kind: "send_prompt" }>,
  client: AssistantHostClient,
  deps: AssistantRequestDeps,
  report: (update: AssistantRequestUpdate) => Promise<unknown>,
): Promise<void> {
  const options: SendMessageOptions = {
    messageId: plan.messageId,
    activeTurnBehavior: plan.activeTurnBehavior,
  };
  try {
    const result = await withTimeout(
      client.sendAgentMessage(plan.agentId, plan.text, options),
      deps.dispatchTimeoutMs,
    );
    if (result === TIMED_OUT) return;
    await report({ state: "completed", agentId: plan.agentId });
  } catch (error) {
    if (isLostReply(error) || settledByError(error)) throw error;
    // The host answered accepted=false: a definite outcome, not a lost reply.
    const message = error instanceof Error ? error.message : String(error);
    await report({ state: "failed", error: { code: "send_rejected", message: clip(message) } });
  }
}

/**
 * Runs one journaled request to the furthest state it can reach now. The plan
 * is committed with dispatchStarted before the first send, and every later
 * run replays that exact plan under the same idempotency key, which the
 * daemon's durable receipts turn into a status read rather than a second run.
 */
export async function runAssistantRequest(
  job: AssistantRequestJob,
  deps: AssistantRequestDeps,
): Promise<void> {
  let queue: Promise<unknown> = Promise.resolve();
  const report = (update: AssistantRequestUpdate) => {
    const committed = queue.then(() => deps.report(update));
    queue = committed.catch(() => undefined);
    return committed;
  };

  try {
    let plan = job.plan;
    let client: AssistantHostClient | null = null;
    if (!plan || !job.dispatchStarted) {
      const args =
        job.operation === "create_agent"
          ? CreateAgentArgumentsSchema.safeParse(job.arguments)
          : SendPromptArgumentsSchema.safeParse(job.arguments);
      if (!args.success) {
        throw stop("rejected", "invalid_arguments", "Paseo could not read the saved request.");
      }
      client = await connected(deps, args.data.serverId);
      if (!plan) {
        plan =
          job.operation === "create_agent"
            ? await planCreateAgent({
                key: job.key,
                args: args.data as CreateAgentArguments,
                client,
                preferences: await deps.loadFormPreferences(),
              })
            : await planSendPrompt({
                key: job.key,
                args: args.data as z.infer<typeof SendPromptArgumentsSchema>,
                client,
              });
      }
      // Another run may have committed first; dispatch whatever the journal holds.
      const stored = StoredRequestSchema.safeParse(
        await report({ plan, dispatchStarted: true, state: "accepted" }),
      );
      if (!stored.success) {
        throw new Error("The journal did not store the request plan");
      }
      if (!PENDING_STATES.has(stored.data.state)) return;
      plan = stored.data.plan;
    } else {
      const serverId = (job.arguments as { serverId?: unknown }).serverId;
      if (typeof serverId !== "string") {
        throw stop("uncertain", "invalid_saved_request", "Paseo could not read the saved request.");
      }
      client = await connected(deps, serverId);
    }

    if (plan.kind === "create_agent") {
      await dispatchCreate(plan, client, deps, report);
    } else {
      await dispatchSend(plan, client, deps, report);
    }
  } catch (error) {
    const settled = error instanceof Outcome ? error.update : settledByError(error);
    if (settled) await report(settled).catch(() => undefined);
  }
  await queue;
}

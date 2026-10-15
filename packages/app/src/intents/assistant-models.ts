import { z } from "zod";
import type { ProviderSnapshotEntry } from "@getpaseo/protocol/agent-types";
import type { AssistantHostConnection } from "./assistant-requests";

export const ASSISTANT_MODEL_DEFAULT_LIMIT = 25;
export const ASSISTANT_MODEL_MAX_LIMIT = 100;
const MAX_LABEL_LENGTH = 120;
const MAX_NOTE_LENGTH = 300;
// A host answers the first snapshot for a directory with "loading" entries.
const SNAPSHOT_ATTEMPTS = 16;
const SNAPSHOT_RETRY_MS = 250;

const AssistantModelsRequestSchema = z.object({
  requestId: z.string().min(1),
  serverId: z.string().min(1),
  projectId: z.string().min(1).nullish(),
  provider: z.string().min(1).nullish(),
  q: z.string().min(1).nullish(),
  limit: z.number().int().min(1).max(ASSISTANT_MODEL_MAX_LIMIT).nullish(),
});

export interface AssistantModelsRequest {
  requestId: string;
  serverId: string;
  projectId: string | null;
  provider: string | null;
  q: string | null;
  limit: number;
}

/**
 * One selectable model, with its provider's status, modes, and thinking
 * options flattened in so a row carries everything create_agent takes. A
 * provider that is not ready, or offers no model list, is one row with an
 * empty `model` and the reason in `note`.
 */
export interface AssistantModelRow {
  serverId: string;
  serverName: string;
  provider: string;
  providerLabel: string;
  status: string;
  model: string;
  modelLabel: string;
  isDefault: number;
  thinkingOptions: string;
  defaultThinkingOption: string;
  modes: string;
  defaultMode: string;
  note: string;
}

/** Validates what the native side handed over; anything malformed is dropped whole. */
export function parseAssistantModelsRequest(raw: unknown): AssistantModelsRequest | null {
  const result = AssistantModelsRequestSchema.safeParse(raw);
  if (!result.success) return null;
  return {
    requestId: result.data.requestId,
    serverId: result.data.serverId,
    projectId: result.data.projectId ?? null,
    provider: result.data.provider ?? null,
    q: result.data.q?.trim().toLowerCase() || null,
    limit: result.data.limit ?? ASSISTANT_MODEL_DEFAULT_LIMIT,
  };
}

function clip(value: string | null | undefined, max = MAX_LABEL_LENGTH): string {
  return (value ?? "").trim().slice(0, max);
}

function providerRows(entry: ProviderSnapshotEntry, host: AssistantModelHost): AssistantModelRow[] {
  const base = {
    ...host,
    provider: entry.provider,
    providerLabel: clip(entry.label) || entry.provider,
    status: entry.status,
    modes: (entry.modes ?? []).map((mode) => mode.id).join(", "),
    defaultMode: entry.defaultModeId ?? "",
  };
  const models =
    entry.status === "ready"
      ? (entry.models ?? []).filter((model) => model.isSelectable !== false)
      : [];
  if (models.length === 0) {
    const reason =
      entry.status === "ready"
        ? "The provider lists no models; omit model to use its default."
        : `The provider is ${entry.status} on this host.`;
    return [
      {
        ...base,
        model: "",
        modelLabel: "",
        isDefault: 0,
        thinkingOptions: "",
        defaultThinkingOption: "",
        note: clip(entry.error ?? reason, MAX_NOTE_LENGTH),
      },
    ];
  }
  return models.map((model) => {
    const thinking = model.thinkingOptions ?? [];
    return {
      serverId: base.serverId,
      serverName: base.serverName,
      provider: base.provider,
      providerLabel: base.providerLabel,
      status: base.status,
      model: model.id,
      modelLabel: clip(model.label) || model.id,
      isDefault: model.isDefault ? 1 : 0,
      thinkingOptions: thinking.map((option) => option.id).join(", "),
      defaultThinkingOption:
        model.defaultThinkingOptionId ?? thinking.find((option) => option.isDefault)?.id ?? "",
      modes: base.modes,
      defaultMode: base.defaultMode,
      note: "",
    };
  });
}

interface AssistantModelHost {
  serverId: string;
  serverName: string;
}

/** Enabled providers in the host's order; models the host marks unselectable are left out. */
export function buildAssistantModelRows(input: {
  request: AssistantModelsRequest;
  serverName: string;
  entries: readonly ProviderSnapshotEntry[];
}): AssistantModelRow[] {
  const { request } = input;
  const host = { serverId: request.serverId, serverName: input.serverName };
  const rows = input.entries
    .filter((entry) => entry.enabled !== false)
    .filter((entry) => !request.provider || entry.provider === request.provider)
    .flatMap((entry) => providerRows(entry, host));
  const q = request.q;
  const matched = q
    ? rows.filter((row) =>
        [row.provider, row.providerLabel, row.model, row.modelLabel].some((value) =>
          value.toLowerCase().includes(q),
        ),
      )
    : rows;
  return matched.slice(0, request.limit);
}

/** A single row the assistant can read out when the host cannot answer. */
export function assistantModelNoticeRow(input: {
  serverId: string;
  serverName?: string;
  note: string;
}): AssistantModelRow {
  return {
    serverId: input.serverId,
    serverName: input.serverName ?? "",
    provider: "",
    providerLabel: "",
    status: "notice",
    model: "",
    modelLabel: "",
    isDefault: 0,
    thinkingOptions: "",
    defaultThinkingOption: "",
    modes: "",
    defaultMode: "",
    note: input.note,
  };
}

/**
 * Reads the host's live provider snapshot, for the project's directory when a
 * projectId is given so availability matches what create_agent would see.
 * Anything that keeps the host from answering is a notice row.
 */
export async function runAssistantModelsQuery(input: {
  request: AssistantModelsRequest;
  connect: (serverId: string) => Promise<AssistantHostConnection>;
  retryDelayMs?: number;
}): Promise<AssistantModelRow[]> {
  const { request } = input;
  const notice = (note: string, serverName?: string) => [
    assistantModelNoticeRow({ serverId: request.serverId, serverName, note }),
  ];
  const connection = await input.connect(request.serverId);
  if (connection.kind === "unknown_host") return notice("Paseo is not paired with that host.");
  if (connection.kind === "offline") {
    return notice(
      "The host is offline, so Paseo cannot read its models; ask again once it is connected.",
      connection.serverName,
    );
  }
  const { client, serverName } = connection;
  let cwd: string | undefined;
  if (request.projectId) {
    const projects = await client.listProjects();
    const project = projects.projects.find(
      (candidate) => candidate.projectId === request.projectId,
    );
    if (!project) return notice("That project is not on this host.", serverName);
    cwd = project.projectRootPath;
  }
  let entries: ProviderSnapshotEntry[] = [];
  for (let attempt = 1; attempt <= SNAPSHOT_ATTEMPTS; attempt += 1) {
    const snapshot = await client.getProvidersSnapshot(cwd ? { cwd } : undefined);
    entries = snapshot.entries;
    if (!entries.some((entry) => entry.status === "loading")) break;
    if (attempt < SNAPSHOT_ATTEMPTS) {
      await new Promise((resolve) => setTimeout(resolve, input.retryDelayMs ?? SNAPSHOT_RETRY_MS));
    }
  }
  if (!entries.some((entry) => entry.enabled !== false)) {
    return notice("No agent providers are enabled on this host.", serverName);
  }
  return buildAssistantModelRows({ request, serverName, entries });
}

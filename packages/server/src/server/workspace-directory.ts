import { resolve } from "node:path";
import type pino from "pino";
import type {
  AgentSnapshotPayload,
  SessionInboundMessage,
  SessionOutboundMessage,
  WorkspaceDescriptorPayload,
} from "./messages.js";
import {
  deriveAgentStateBucket,
  getWorkspaceStateBucketPriority,
  type WorkspaceStateBucket,
} from "@getpaseo/protocol/agent-state-bucket";
import { getParentAgentIdFromLabels } from "@getpaseo/protocol/agent-labels";
import { SortablePager } from "./pagination/sortable-pager.js";
import type { PersistedProjectRecord, PersistedWorkspaceRecord } from "./workspace-registry.js";
import { resolveProjectDisplayName } from "./workspace-registry.js";
import {
  deriveTerminalActivityStatusBucket,
  type TerminalActivity,
} from "@getpaseo/protocol/terminal-activity";
import type { ProviderSubagentDescriptor } from "./agent/provider-subagents/store.js";

const FETCH_WORKSPACES_SORT_KEYS = [
  "status_priority",
  "activity_at",
  "name",
  "project_id",
] as const;

/**
 * Per-workspace bucket history. Drives the priority-unmasking semantic for
 * `statusEnteredAt`: when the winning bucket changes from a higher-priority
 * mask to a lower-priority bucket, the new entry time is the unmask time
 * (i.e., the moment the higher-priority bucket cleared), not when the
 * underlying agent originally entered the lower-priority bucket. A fresh
 * workspace enters its initial `done` bucket at creation time, even before any
 * agent or terminal contributes activity.
 */
export interface WorkspaceBucketHistoryEntry {
  bucket: WorkspaceStateBucket;
  enteredAt: string;
}

interface WorkspaceBucketTimestampEntry {
  bucket: WorkspaceStateBucket;
  changedAtIso: string;
}

type FetchWorkspacesRequestMessage = Extract<
  SessionInboundMessage,
  { type: "fetch_workspaces_request" }
>;
type FetchWorkspacesRequestFilter = NonNullable<FetchWorkspacesRequestMessage["filter"]>;
type FetchWorkspacesRequestSort = NonNullable<FetchWorkspacesRequestMessage["sort"]>[number];
type FetchWorkspacesResponsePayload = Extract<
  SessionOutboundMessage,
  { type: "fetch_workspaces_response" }
>["payload"];
type FetchWorkspacesResponseEntry = FetchWorkspacesResponsePayload["entries"][number];
type FetchWorkspacesResponsePageInfo = FetchWorkspacesResponsePayload["pageInfo"];
type WorkspaceProjectDescriptor = FetchWorkspacesResponsePayload["emptyProjects"][number];

export type WorkspaceUpdatesFilter = FetchWorkspacesRequestFilter;

export type ProviderSubagentWorkspaceActivity = Pick<
  ProviderSubagentDescriptor,
  "parentAgentId" | "status" | "updatedAt"
>;

export interface WorkspaceDirectoryDeps {
  logger: pino.Logger;
  projectRegistry: {
    list(): Promise<PersistedProjectRecord[]>;
  };
  workspaceRegistry: {
    list(): Promise<PersistedWorkspaceRecord[]>;
  };
  listAgentPayloads(): Promise<AgentSnapshotPayload[]>;
  listAgentActivityAt(): Promise<ReadonlyMap<string, string>>;
  listProviderSubagentActivity(): Promise<ProviderSubagentWorkspaceActivity[]>;
  listTerminalActivityContributions(): Promise<
    Array<{ cwd: string; workspaceId?: string; activity: TerminalActivity | null }>
  >;
  isProviderVisibleToClient(provider: string): boolean;
  /**
   * Daemon-scoped bucket history shared by every session with the same provider
   * visibility. A directory instance lives only as long as its client's
   * connection, so private history would restamp `statusEnteredAt` on every
   * reload; the shared map keeps the anchor stable across reconnects. Resolved
   * per recompute because the scope follows the client's app version, which is
   * only reported after the connection is up.
   */
  getBucketHistory?(): Map<string, WorkspaceBucketHistoryEntry>;
  buildWorkspaceDescriptor(input: {
    workspace: PersistedWorkspaceRecord;
    projectRecord?: PersistedProjectRecord | null;
    includeGitData: boolean;
  }): Promise<WorkspaceDescriptorPayload>;
}

export function summarizeFetchWorkspacesEntries(entries: Iterable<FetchWorkspacesResponseEntry>): {
  count: number;
  projectIds: string[];
  statusCounts: Record<string, number>;
  workspaces: Array<{
    id: string;
    projectId: string;
    projectDisplayName: string;
    name: string;
    status: FetchWorkspacesResponseEntry["status"];
    workspaceKind: FetchWorkspacesResponseEntry["workspaceKind"];
    activityAt: string | null;
  }>;
} {
  const workspaces = Array.from(entries, (entry) => ({
    id: entry.id,
    projectId: entry.projectId,
    projectDisplayName: entry.projectDisplayName,
    name: entry.name,
    status: entry.status,
    workspaceKind: entry.workspaceKind,
    activityAt: entry.activityAt,
  }));
  const statusCounts = new Map<string, number>();
  for (const workspace of workspaces) {
    statusCounts.set(workspace.status, (statusCounts.get(workspace.status) ?? 0) + 1);
  }

  return {
    count: workspaces.length,
    projectIds: [...new Set(workspaces.map((workspace) => workspace.projectId))],
    statusCounts: Object.fromEntries(statusCounts),
    workspaces,
  };
}

/**
 * Git facts (branch, diff, dirty, PR) belong to a checkout on disk, not to a
 * workspace identity. Every workspace whose own cwd is that checkout re-derives
 * its git facts from the same folder. This returns the ids of those workspaces
 * so a git change can fan out to all of them. This is git-fact display, NOT
 * ownership: do not use it to decide which workspace owns an arbitrary path.
 */
export function workspaceIdsOnCheckout(
  workspaces: Iterable<PersistedWorkspaceRecord>,
  cwd: string,
): string[] {
  const resolvedCwd = resolve(cwd);
  return Array.from(workspaces)
    .filter((workspace) => !workspace.archivedAt && resolve(workspace.cwd) === resolvedCwd)
    .map((workspace) => workspace.workspaceId);
}

export function workspaceIdsForProjects(
  workspaces: Iterable<PersistedWorkspaceRecord>,
  projectIds: ReadonlySet<string>,
): string[] {
  const workspaceIds = new Set<string>();
  for (const workspace of workspaces) {
    if (projectIds.has(workspace.projectId)) workspaceIds.add(workspace.workspaceId);
  }
  return Array.from(workspaceIds);
}

export class WorkspaceDirectory {
  private readonly archivingByWorkspaceId = new Map<string, string>();
  /**
   * Per-workspace last-seen winning bucket + entered-at. Daemon-lifetime state
   * (see `WorkspaceDirectoryDeps.getBucketHistory`); reset on cold start.
   * Server-internal; never crosses the wire.
   */
  private readonly fallbackBucketHistory = new Map<string, WorkspaceBucketHistoryEntry>();

  private get bucketHistoryByWorkspaceId(): Map<string, WorkspaceBucketHistoryEntry> {
    return this.deps.getBucketHistory?.() ?? this.fallbackBucketHistory;
  }

  private readonly pager = new SortablePager<
    WorkspaceDescriptorPayload,
    FetchWorkspacesRequestSort["key"]
  >({
    validKeys: FETCH_WORKSPACES_SORT_KEYS,
    defaultSort: [{ key: "activity_at", direction: "desc" }],
    label: "fetch_workspaces",
    getId: (workspace) => workspace.id,
    getSortValue: (workspace, key) => {
      switch (key) {
        case "status_priority":
          return getWorkspaceStateBucketPriority(workspace.status);
        case "activity_at":
          return workspace.activityAt ? Date.parse(workspace.activityAt) : null;
        case "name":
          return workspace.name.toLocaleLowerCase();
        case "project_id":
          return workspace.projectId.toLocaleLowerCase();
        default:
          throw new Error("unreachable");
      }
    },
  });

  constructor(private readonly deps: WorkspaceDirectoryDeps) {}

  markArchiving(workspaceIds: Iterable<string>, archivingAt: string): void {
    for (const workspaceId of workspaceIds) {
      this.archivingByWorkspaceId.set(workspaceId, archivingAt);
    }
  }

  clearArchiving(workspaceIds: Iterable<string>): void {
    for (const workspaceId of workspaceIds) {
      this.archivingByWorkspaceId.delete(workspaceId);
    }
  }

  async buildDescriptorMap(options: {
    includeGitData: boolean;
    workspaceIds?: Iterable<string>;
  }): Promise<Map<string, WorkspaceDescriptorPayload>> {
    const [
      agents,
      agentActivityAtById,
      providerSubagentActivity,
      persistedWorkspaces,
      persistedProjects,
      terminalContributions,
    ] = await Promise.all([
      this.deps.listAgentPayloads(),
      this.deps.listAgentActivityAt(),
      this.deps.listProviderSubagentActivity(),
      this.deps.workspaceRegistry.list(),
      this.deps.projectRegistry.list(),
      this.deps.listTerminalActivityContributions(),
    ]);

    const activeProjects = new Map(
      persistedProjects
        .filter((project) => !project.archivedAt)
        .map((project) => [project.projectId, project] as const),
    );
    const archivedProjectIds = new Set(
      persistedProjects.filter((project) => project.archivedAt).map((project) => project.projectId),
    );
    const activeRecords = persistedWorkspaces.filter(
      (workspace) => !workspace.archivedAt && !archivedProjectIds.has(workspace.projectId),
    );
    const descriptorsByWorkspaceId = new Map<string, WorkspaceDescriptorPayload>();
    const workspaceIds = options.workspaceIds ? new Set(options.workspaceIds) : null;
    const activeWorkspaceIds = new Set(activeRecords.map((workspace) => workspace.workspaceId));
    const includedWorkspaces = activeRecords.filter(
      (workspace) => !workspaceIds || workspaceIds.has(workspace.workspaceId),
    );
    const activeRecordsByWorkspaceId = new Map(
      activeRecords.map((workspace) => [workspace.workspaceId, workspace] as const),
    );
    const workspaceDescriptors = await Promise.all(
      includedWorkspaces.map((workspace) =>
        this.deps.buildWorkspaceDescriptor({
          workspace,
          projectRecord: activeProjects.get(workspace.projectId) ?? null,
          includeGitData: options.includeGitData,
        }),
      ),
    );
    for (let i = 0; i < includedWorkspaces.length; i += 1) {
      const workspaceId = includedWorkspaces[i].workspaceId;
      descriptorsByWorkspaceId.set(workspaceId, {
        ...workspaceDescriptors[i],
        archivingAt: this.archivingByWorkspaceId.get(workspaceId) ?? null,
      });
    }

    const visibleAgents = agents.filter((agent) =>
      this.deps.isProviderVisibleToClient(agent.provider),
    );
    const activeAgents = visibleAgents.filter((agent) => !agent.archivedAt);
    this.applyAgentBucketContributions({
      activeAgents,
      descriptorsByWorkspaceId,
    });

    const sourceActivityAtByWorkspaceId = new Map<string, string>();
    // Terminal activity contributions: working terminal → running bucket.
    const activityEntriesByWorkspaceId = this.applyTerminalContributions(
      terminalContributions,
      descriptorsByWorkspaceId,
      sourceActivityAtByWorkspaceId,
    );
    this.applyProviderSubagentContributions({
      activeAgents,
      providerSubagentActivity,
      descriptorsByWorkspaceId,
      activityEntriesByWorkspaceId,
      sourceActivityAtByWorkspaceId,
    });

    const contributingAgentsByWorkspaceId = groupAgentsByWorkspaceId(
      activeAgents,
      activeWorkspaceIds,
    );
    const activityAgentsByWorkspaceId = groupAgentsByWorkspaceId(visibleAgents, activeWorkspaceIds);

    // Resolve the workspace-level `statusEnteredAt` (see aggregate semantics
    // on `resolveStatusEnteredAt`).
    const nowIso = new Date().toISOString();
    for (const [workspaceId, descriptor] of descriptorsByWorkspaceId) {
      const contributingAgents = contributingAgentsByWorkspaceId.get(workspaceId) ?? [];
      const activityEntries = activityEntriesByWorkspaceId.get(workspaceId) ?? [];
      descriptor.activityAt = this.findNewestActivityTimestamp(
        activityAgentsByWorkspaceId.get(workspaceId) ?? [],
        agentActivityAtById,
        sourceActivityAtByWorkspaceId.get(workspaceId) ?? null,
      );
      const result = this.resolveStatusEnteredAt({
        workspaceId,
        winningBucket: descriptor.status,
        contributingAgents,
        activityEntries,
        previous: this.bucketHistoryByWorkspaceId.get(workspaceId) ?? null,
        workspaceCreatedAt: activeRecordsByWorkspaceId.get(workspaceId)?.createdAt ?? null,
        nowIso,
      });
      descriptor.statusEnteredAt = result.statusEnteredAt;
      if (result.recordUpdate) {
        this.bucketHistoryByWorkspaceId.set(workspaceId, result.recordUpdate);
      } else if (result.recordDelete) {
        this.bucketHistoryByWorkspaceId.delete(workspaceId);
      }
    }

    return descriptorsByWorkspaceId;
  }

  private applyProviderSubagentContributions(params: {
    activeAgents: AgentSnapshotPayload[];
    providerSubagentActivity: ProviderSubagentWorkspaceActivity[];
    descriptorsByWorkspaceId: Map<string, WorkspaceDescriptorPayload>;
    activityEntriesByWorkspaceId: Map<string, WorkspaceBucketTimestampEntry[]>;
    sourceActivityAtByWorkspaceId: Map<string, string>;
  }): void {
    const {
      activeAgents,
      providerSubagentActivity,
      descriptorsByWorkspaceId,
      activityEntriesByWorkspaceId,
      sourceActivityAtByWorkspaceId,
    } = params;
    const activeAgentsById = new Map(activeAgents.map((agent) => [agent.id, agent] as const));

    for (const subagent of providerSubagentActivity) {
      const parent = activeAgentsById.get(subagent.parentAgentId);
      if (!parent) {
        continue;
      }
      const workspaceAgent = resolveWorkspaceRootAgent(parent, activeAgentsById);
      const workspaceId = workspaceAgent?.workspaceId;
      if (!workspaceId) {
        continue;
      }
      const descriptor = descriptorsByWorkspaceId.get(workspaceId);
      if (!descriptor) {
        continue;
      }
      recordLatestWorkspaceActivity(sourceActivityAtByWorkspaceId, workspaceId, subagent.updatedAt);
      if (subagent.status !== "running") {
        continue;
      }
      if (
        getWorkspaceStateBucketPriority("running") <
        getWorkspaceStateBucketPriority(descriptor.status)
      ) {
        descriptor.status = "running";
      }
      const entries = activityEntriesByWorkspaceId.get(workspaceId) ?? [];
      entries.push({ bucket: "running", changedAtIso: subagent.updatedAt });
      activityEntriesByWorkspaceId.set(workspaceId, entries);
    }
  }

  // Aggregate each agent's state bucket into its owning workspace descriptor,
  // keeping the highest-priority bucket. A record's owner IS its `workspaceId`;
  // status never fans out to same-cwd siblings. A subagent in another workspace
  // is a root for that workspace. Same-workspace descendants contribute only
  // running activity to the nearest ancestor in that workspace.
  private applyAgentBucketContributions(params: {
    activeAgents: AgentSnapshotPayload[];
    descriptorsByWorkspaceId: Map<string, WorkspaceDescriptorPayload>;
  }): void {
    const { activeAgents, descriptorsByWorkspaceId } = params;
    const activeAgentsById = new Map(activeAgents.map((agent) => [agent.id, agent] as const));

    for (const agent of activeAgents) {
      const workspaceAgent = resolveWorkspaceRootAgent(agent, activeAgentsById);
      if (!workspaceAgent) {
        continue;
      }
      const isWorkspaceRoot = workspaceAgent.id === agent.id;
      if (!isWorkspaceRoot && agent.status !== "running") {
        continue;
      }
      const bucket = isWorkspaceRoot
        ? deriveAgentStateBucket({
            status: agent.status,
            pendingPermissionCount: agent.pendingPermissions?.length ?? 0,
            requiresAttention: agent.requiresAttention,
            attentionReason: agent.attentionReason ?? null,
          })
        : "running";

      const workspaceId = workspaceAgent.workspaceId;
      if (!workspaceId) {
        continue;
      }
      const existing = descriptorsByWorkspaceId.get(workspaceId);
      if (!existing) {
        continue;
      }
      if (
        getWorkspaceStateBucketPriority(bucket) < getWorkspaceStateBucketPriority(existing.status)
      ) {
        existing.status = bucket;
      }
    }
  }

  // Apply terminal activity to each workspace's last-active timestamp. States
  // with a status bucket also contribute to `resolveStatusEnteredAt`.
  // A terminal contributes only to the workspace it carries; same-cwd siblings
  // are untouched.
  private applyTerminalContributions(
    terminalContributions: Array<{
      cwd: string;
      workspaceId?: string;
      activity: TerminalActivity | null;
    }>,
    descriptorsByWorkspaceId: Map<string, WorkspaceDescriptorPayload>,
    sourceActivityAtByWorkspaceId: Map<string, string>,
  ): Map<string, WorkspaceBucketTimestampEntry[]> {
    const activityEntriesByWorkspaceId = new Map<string, WorkspaceBucketTimestampEntry[]>();
    for (const { workspaceId, activity } of terminalContributions) {
      if (!activity || !workspaceId) {
        continue;
      }
      const existing = descriptorsByWorkspaceId.get(workspaceId);
      if (!existing) {
        continue;
      }
      const changedAtIso = new Date(activity.changedAt).toISOString();
      recordLatestWorkspaceActivity(sourceActivityAtByWorkspaceId, workspaceId, changedAtIso);
      const bucket = deriveTerminalActivityStatusBucket(activity);
      if (!bucket) {
        continue;
      }
      if (
        getWorkspaceStateBucketPriority(bucket) < getWorkspaceStateBucketPriority(existing.status)
      ) {
        existing.status = bucket;
      }
      const entries = activityEntriesByWorkspaceId.get(workspaceId) ?? [];
      entries.push({ bucket, changedAtIso });
      activityEntriesByWorkspaceId.set(workspaceId, entries);
    }
    return activityEntriesByWorkspaceId;
  }

  // Aggregate the workspace-level `statusEnteredAt` from its activity sources.
  // Aggregate semantics:
  //   - winning bucket = highest-priority across contributing activity;
  //   - entry time = best-effort timestamp from sources in the winning bucket;
  //   - priority unmasking: when the winning bucket transitions (e.g. a
  //     higher-priority bucket cleared), the new entry time is "now";
  //   - same-bucket emits reuse the previous entered-at;
  //   - empty workspaces that never had contributing activity use
  //     their workspace creation time as their initial `done` entry time.
  //   - when archived agents leave a previously active workspace empty, keep
  //     the previous done timestamp or stamp the transition to done now.
  private resolveStatusEnteredAt(params: {
    workspaceId: string;
    winningBucket: WorkspaceStateBucket;
    contributingAgents: AgentSnapshotPayload[];
    activityEntries: WorkspaceBucketTimestampEntry[];
    previous: WorkspaceBucketHistoryEntry | null;
    workspaceCreatedAt: string | null;
    nowIso: string;
  }): {
    statusEnteredAt: string | null;
    recordUpdate?: WorkspaceBucketHistoryEntry;
    recordDelete?: true;
  } {
    const {
      winningBucket,
      contributingAgents,
      activityEntries,
      previous,
      workspaceCreatedAt,
      nowIso,
    } = params;

    if (contributingAgents.length === 0 && activityEntries.length === 0) {
      if (!previous) {
        if (!workspaceCreatedAt) {
          return { statusEnteredAt: null };
        }

        return {
          statusEnteredAt: workspaceCreatedAt,
          recordUpdate: { bucket: "done", enteredAt: workspaceCreatedAt },
        };
      }

      const enteredAt = previous.bucket === "done" ? previous.enteredAt : nowIso;
      return {
        statusEnteredAt: enteredAt,
        recordUpdate: { bucket: "done", enteredAt },
      };
    }

    if (!previous) {
      const newestInWinningBucket = this.findNewestTimestampInBucket(
        contributingAgents,
        activityEntries,
        winningBucket,
      );
      const enteredAt = newestInWinningBucket ?? nowIso;
      return {
        statusEnteredAt: enteredAt,
        recordUpdate: { bucket: winningBucket, enteredAt },
      };
    }

    if (previous.bucket !== winningBucket) {
      return {
        statusEnteredAt: nowIso,
        recordUpdate: { bucket: winningBucket, enteredAt: nowIso },
      };
    }

    return {
      statusEnteredAt: previous.enteredAt,
      recordUpdate: previous,
    };
  }

  // Best-effort newest timestamp across contributing agents and other activity
  // whose bucket matches `winningBucket`. For agents, uses:
  //   - `attentionTimestamp` when attention is set (covers attention/failed)
  //   - `updatedAt` as a general fallback for any bucket
  // Returns `null` if no matching contributor has a parseable timestamp.
  private findNewestTimestampInBucket(
    contributingAgents: AgentSnapshotPayload[],
    activityEntries: WorkspaceBucketTimestampEntry[],
    winningBucket: WorkspaceStateBucket,
  ): string | null {
    const agentTimestamps = contributingAgents
      .filter((agent) => {
        const derived = deriveAgentStateBucket({
          status: agent.status,
          pendingPermissionCount: agent.pendingPermissions?.length ?? 0,
          requiresAttention: agent.requiresAttention,
          attentionReason: agent.attentionReason ?? null,
        });
        return derived === winningBucket;
      })
      .map((agent) => {
        // Prefer attentionTimestamp when the agent has attention set — this is
        // the most accurate "entered current status" signal.
        if (agent.attentionTimestamp) {
          return agent.attentionTimestamp;
        }
        // Fall back to updatedAt as a general proxy for recent activity.
        return agent.updatedAt;
      })
      .filter((value): value is string => typeof value === "string" && value.length > 0);

    const activityTimestamps = activityEntries
      .filter((entry) => entry.bucket === winningBucket)
      .map((entry) => entry.changedAtIso);

    const candidates = [...agentTimestamps, ...activityTimestamps].sort();
    return candidates.at(-1) ?? null;
  }

  private findNewestActivityTimestamp(
    contributingAgents: AgentSnapshotPayload[],
    agentActivityAtById: ReadonlyMap<string, string>,
    sourceActivityAt: string | null,
  ): string | null {
    let latest = sourceActivityAt;
    for (const agent of contributingAgents) {
      latest = laterTimestamp(latest, agentActivityAtById.get(agent.id) ?? agent.updatedAt);
      latest = laterTimestamp(latest, agent.lastUserMessageAt);
      latest = laterTimestamp(latest, agent.attentionTimestamp);
    }
    return latest;
  }

  // Project parents that have no active workspaces. The wire field is the
  // sidebar projection bucket for projects whose workspace list is currently
  // empty; it is not a separate domain record.
  async listEmptyProjects(): Promise<WorkspaceProjectDescriptor[]> {
    const [persistedWorkspaces, persistedProjects] = await Promise.all([
      this.deps.workspaceRegistry.list(),
      this.deps.projectRegistry.list(),
    ]);
    const projectIdsWithActiveWorkspaces = new Set(
      persistedWorkspaces
        .filter((workspace) => !workspace.archivedAt)
        .map((workspace) => workspace.projectId),
    );
    return persistedProjects
      .filter(
        (project) => !project.archivedAt && !projectIdsWithActiveWorkspaces.has(project.projectId),
      )
      .map((project) => ({
        projectId: project.projectId,
        projectKey: project.projectKey ?? undefined,
        projectDisplayName: resolveProjectDisplayName(project),
        projectCustomName: project.customName ?? null,
        projectCustomIconRevision: project.customIconRevision ?? null,
        projectRootPath: project.rootPath,
        projectKind: project.kind,
      }));
  }

  async listDescriptors(): Promise<WorkspaceDescriptorPayload[]> {
    return Array.from(
      (
        await this.buildDescriptorMap({
          includeGitData: true,
        })
      ).values(),
    );
  }

  matchesFilter(input: {
    workspace: WorkspaceDescriptorPayload;
    filter: FetchWorkspacesRequestFilter | undefined;
  }): boolean {
    const { workspace, filter } = input;
    if (!filter) {
      return true;
    }

    if (filter.projectId && filter.projectId.trim().length > 0) {
      if (workspace.projectId !== filter.projectId.trim()) {
        return false;
      }
    }

    if (filter.query && filter.query.trim().length > 0) {
      const query = filter.query.trim().toLocaleLowerCase();
      const haystacks = [workspace.name, workspace.projectId, workspace.id];
      if (!haystacks.some((value) => value.toLocaleLowerCase().includes(query))) {
        return false;
      }
    }

    return true;
  }

  async listFetchEntries(request: FetchWorkspacesRequestMessage): Promise<{
    entries: FetchWorkspacesResponseEntry[];
    emptyProjects: WorkspaceProjectDescriptor[];
    pageInfo: FetchWorkspacesResponsePageInfo;
  }> {
    const filter = request.filter;
    const sort = this.pager.normalizeSort(request.sort);
    let entries = await this.listDescriptors();
    const listedCount = entries.length;
    entries = entries.filter((workspace) => this.matchesFilter({ workspace, filter }));
    const filteredCount = entries.length;
    entries.sort((left, right) => this.pager.compare(left, right, sort));

    const cursorToken = request.page?.cursor;
    if (cursorToken) {
      const cursor = this.pager.decode(cursorToken, sort);
      entries = entries.filter(
        (workspace) => this.pager.compareWithCursor(workspace, cursor, sort) > 0,
      );
    }

    const limit = request.page?.limit ?? 200;
    const pagedEntries = entries.slice(0, limit);
    const hasMore = entries.length > limit;
    const nextCursor =
      hasMore && pagedEntries.length > 0
        ? this.pager.encode(pagedEntries[pagedEntries.length - 1], sort)
        : null;

    // Project parents with no active workspaces ride only on the first page so
    // the sidebar can render them without duplicating them across pagination.
    const projectIdFilter = filter?.projectId?.trim();
    const emptyProjects = cursorToken
      ? []
      : (await this.listEmptyProjects()).filter(
          (project) => !projectIdFilter || project.projectId === projectIdFilter,
        );

    this.deps.logger.debug(
      {
        requestId: request.requestId,
        filter: request.filter ?? null,
        sort,
        page: request.page ?? null,
        listedCount,
        filteredCount,
        returnedCount: pagedEntries.length,
        hasMore,
        nextCursor,
      },
      "fetch_workspaces_entries_listed",
    );

    return {
      entries: pagedEntries,
      emptyProjects,
      pageInfo: {
        nextCursor,
        prevCursor: request.page?.cursor ?? null,
        hasMore,
      },
    };
  }
}

function groupAgentsByWorkspaceId(
  agents: AgentSnapshotPayload[],
  activeWorkspaceIds: ReadonlySet<string>,
): Map<string, AgentSnapshotPayload[]> {
  const byWorkspaceId = new Map<string, AgentSnapshotPayload[]>();
  for (const agent of agents) {
    const workspaceId = agent.workspaceId;
    if (!workspaceId || !activeWorkspaceIds.has(workspaceId)) {
      continue;
    }
    const entries = byWorkspaceId.get(workspaceId) ?? [];
    entries.push(agent);
    byWorkspaceId.set(workspaceId, entries);
  }
  return byWorkspaceId;
}

function recordLatestWorkspaceActivity(
  activityAtByWorkspaceId: Map<string, string>,
  workspaceId: string,
  candidate: string | null | undefined,
): void {
  const latest = laterTimestamp(activityAtByWorkspaceId.get(workspaceId) ?? null, candidate);
  if (latest) {
    activityAtByWorkspaceId.set(workspaceId, latest);
  }
}

function laterTimestamp(
  current: string | null,
  candidate: string | null | undefined,
): string | null {
  if (!candidate) {
    return current;
  }
  const candidateTime = Date.parse(candidate);
  if (Number.isNaN(candidateTime)) {
    return current;
  }
  if (!current) {
    return candidate;
  }
  const currentTime = Date.parse(current);
  return Number.isNaN(currentTime) || candidateTime > currentTime ? candidate : current;
}

function resolveWorkspaceRootAgent(
  agent: AgentSnapshotPayload,
  activeAgentsById: ReadonlyMap<string, AgentSnapshotPayload>,
): AgentSnapshotPayload | null {
  const seen = new Set<string>([agent.id]);
  let current = agent;

  while (true) {
    const parentAgentId = getParentAgentIdFromLabels(current.labels);
    if (!parentAgentId) {
      return current;
    }
    if (seen.has(parentAgentId)) {
      return null;
    }
    const parent = activeAgentsById.get(parentAgentId);
    if (!parent) {
      return null;
    }
    if (parent.workspaceId !== current.workspaceId) {
      return current;
    }
    seen.add(parentAgentId);
    current = parent;
  }
}

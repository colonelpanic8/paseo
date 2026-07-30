import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";

import { parseWearCommand, type WearCommand, type WearSnapshot } from "./wear-protocol";
import { buildWearSnapshot, type WearSnapshotInput } from "./wear-snapshot";
import { buildWearTranscript, isTranscriptEntry, MAX_TRANSCRIPT_ENTRIES } from "./wear-transcript";

export interface WearBridgeTransport {
  publishSnapshot(payload: string): Promise<boolean>;
  /** Publishes to a per-agent path, so open transcripts don't clobber each other. */
  publishTranscript(agentId: string, payload: string): Promise<boolean>;
  addCommandListener(listener: (payload: string) => void): { remove(): void };
  drainPendingCommands(): Promise<string[]>;
}

/**
 * Paging for a transcript request.
 *
 * The daemon's tail page is sized for a phone screen, so reaching a wrist-sized
 * transcript usually takes more than one. The request cap is a hard stop: a watch
 * asking for an agent with a very long history must not turn into an unbounded
 * walk backwards through its timeline.
 */
const TRANSCRIPT_PAGE_SIZE = 40;
const MAX_TRANSCRIPT_REQUESTS = 4;

/**
 * How long a transcript request keeps the phone pushing updates for that agent.
 *
 * The watch re-requests roughly once a minute while an agent screen is open, so this
 * is set well above that cadence: an open screen renews long before the lease lapses,
 * and a screen the user left stops costing timeline fetches within ~2.5 minutes.
 */
const LEASE_MS = 150_000;

/**
 * Trailing delay before a leased agent's transcript is refetched.
 *
 * A single agent turn produces a burst of store changes, and each transcript refresh
 * is several daemon round-trips plus a Data Layer write. Coalescing turns the burst
 * into one fetch while still landing on the wrist within a couple of seconds.
 */
const COALESCE_MS = 2_000;

/** A watch is currently reading this agent's transcript. */
interface TranscriptLease {
  serverId: string;
  expiresAt: number;
  /**
   * `lastActivityAt` as of the most recent fetch we started, which is what a later
   * sweep compares against. Recorded before the fetch rather than after, so activity
   * that happens while the fetch is in flight still triggers a follow-up. Null means
   * the agent wasn't in state at that moment, which counts as "unknown", not "quiet".
   */
  lastActivityAt: number | null;
}

export interface NewAgentConfig {
  provider: string;
  cwd: string;
}

export interface WearBridgeDeps {
  transport: WearBridgeTransport;
  /** Current state of every connected daemon, one entry per server. */
  readState: () => WearSnapshotInput[];
  /** Daemon client for a server, or null when that server isn't connected. */
  getClient: (serverId: string) => DaemonClient | null;
  /**
   * Provider and cwd for a new agent in a workspace. The watch has no provider
   * picker by design, so the phone decides — normally by reusing whatever provider
   * that workspace last used. Returning null refuses the create.
   */
  resolveNewAgentConfig: (serverId: string, workspaceId: string) => NewAgentConfig | null;
  now?: () => number;
  logger?: {
    warn(message: string, error?: unknown): void;
    info?(message: string): void;
  };
}

/**
 * Owns the phone half of the watch bridge: publishes snapshots and executes the
 * commands the watch sends back.
 *
 * Transport is injected so this is testable without Play Services — the native
 * module is one implementation of [WearBridgeTransport], not a hard dependency.
 */
export class WearBridge {
  private readonly deps: WearBridgeDeps;
  private subscription: { remove(): void } | null = null;
  private lastPublished: string | null = null;
  /** Per-agent request counter, so a slow fetch can't overwrite a newer transcript. */
  private readonly transcriptGenerations = new Map<string, number>();
  /** Agents a watch is currently reading, keyed by agent id. */
  private readonly transcriptLeases = new Map<string, TranscriptLease>();
  /** At most one pending refresh per agent; the handle is what makes it coalesce. */
  private readonly transcriptTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private disposed = false;

  constructor(deps: WearBridgeDeps) {
    this.deps = deps;
  }

  async start(): Promise<void> {
    if (this.subscription) return;
    this.subscription = this.deps.transport.addCommandListener((payload) => {
      void this.handleCommandPayload(payload);
    });

    // Commands can arrive while the app process is dead — Play Services starts only
    // the native listener service, which persists them. Drain before the first
    // publish so a queued approval isn't overwritten by a snapshot that still shows
    // it pending.
    await this.drainQueued();
    await this.publish();
  }

  stop(): void {
    this.disposed = true;
    this.subscription?.remove();
    this.subscription = null;
    for (const timer of this.transcriptTimers.values()) {
      clearTimeout(timer);
    }
    this.transcriptTimers.clear();
    this.transcriptLeases.clear();
  }

  private async drainQueued(): Promise<void> {
    const queued = await this.deps.transport.drainPendingCommands().catch((error: unknown) => {
      this.deps.logger?.warn("Failed to drain queued wear commands", error);
      return [] as string[];
    });
    for (const payload of queued) {
      await this.handleCommandPayload(payload);
    }
  }

  /**
   * Publish the current state. Skips the native call when the JSON is byte-identical
   * to the last publish, because building the payload is cheap but waking the Data
   * Layer is not.
   */
  async publish(options?: { force?: boolean }): Promise<void> {
    if (this.disposed) return;
    const now = this.deps.now?.() ?? Date.now();
    const state = this.deps.readState();

    // Ahead of the unchanged-payload short-circuit below, because most new activity
    // does not change the snapshot at all: the only agent field it moves is `age`,
    // which is minute-granular. Sweeping after the early return would leave open
    // transcripts stale for up to a minute, which is the bug this exists to fix.
    this.sweepTranscriptLeases(state, now);

    const snapshot = buildWearSnapshot(state, now);
    const payload = stableSnapshotKey(snapshot);

    if (!options?.force && payload === this.lastPublished) return;

    const ok = await this.deps.transport
      .publishSnapshot(JSON.stringify(snapshot))
      .catch((error: unknown) => {
        this.deps.logger?.warn("Failed to publish wear snapshot", error);
        return false;
      });
    if (ok) {
      this.lastPublished = payload;
    }
  }

  /**
   * Push transcript updates to whichever agents a watch currently has open.
   *
   * Runs on every store change, so it must stay cheap when nothing is leased — which
   * is the normal case, since a lease only exists while a watch screen is open.
   */
  private sweepTranscriptLeases(state: WearSnapshotInput[], now: number): void {
    if (this.transcriptLeases.size === 0) return;

    const activity = lastActivityIndex(state);
    for (const [agentId, lease] of this.transcriptLeases) {
      if (lease.expiresAt <= now) {
        this.dropTranscriptLease(agentId);
        continue;
      }

      const lastActivityAt = activity.get(activityKey(lease.serverId, agentId));
      if (lastActivityAt === undefined) {
        // The agent is gone from state — disconnected server, or archived away. The
        // watch has nothing to show either way, so stop fetching for it.
        this.dropTranscriptLease(agentId);
        continue;
      }

      if (lastActivityAt === lease.lastActivityAt) continue;
      this.scheduleTranscriptRefresh(lease.serverId, agentId);
    }
  }

  private scheduleTranscriptRefresh(serverId: string, agentId: string): void {
    // One timer per agent is what coalesces the burst; the generation guard only
    // protects the content that lands, it doesn't stop redundant fetches.
    if (this.transcriptTimers.has(agentId)) return;

    const timer = setTimeout(() => {
      this.transcriptTimers.delete(agentId);
      if (this.disposed) return;
      void this.publishTranscript(serverId, agentId);
    }, COALESCE_MS);
    this.transcriptTimers.set(agentId, timer);
  }

  private dropTranscriptLease(agentId: string): void {
    this.transcriptLeases.delete(agentId);
    this.cancelTranscriptRefresh(agentId);
  }

  private cancelTranscriptRefresh(agentId: string): void {
    const timer = this.transcriptTimers.get(agentId);
    if (timer === undefined) return;
    clearTimeout(timer);
    this.transcriptTimers.delete(agentId);
  }

  /**
   * Start or extend the watch's lease on an agent's transcript.
   *
   * Renewal is just a new expiry: the recorded activity marker stays, so a re-request
   * that arrives mid-burst doesn't hide activity from the next sweep.
   */
  private renewTranscriptLease(serverId: string, agentId: string, now: number): void {
    const existing = this.transcriptLeases.get(agentId);
    if (existing && existing.serverId === serverId) {
      existing.expiresAt = now + LEASE_MS;
      return;
    }
    this.transcriptLeases.set(agentId, {
      serverId,
      expiresAt: now + LEASE_MS,
      lastActivityAt: null,
    });
  }

  private async handleCommandPayload(payload: string): Promise<void> {
    const command = parseWearCommand(payload);
    if (!command) {
      this.deps.logger?.warn(`Ignoring unparseable wear command: ${payload.slice(0, 120)}`);
      return;
    }
    await this.execute(command);
  }

  /**
   * Fetch enough of an agent's timeline to fill a wrist and publish it.
   *
   * Pages backwards from the tail, because the newest turn is what the watch opened
   * the screen to read; older pages are prepended so the result stays oldest-first.
   */
  private async publishTranscript(serverId: string, agentId: string): Promise<void> {
    // Whatever a pending refresh was going to fetch, this fetch covers.
    this.cancelTranscriptRefresh(agentId);

    // Read before the fetch, not after: activity that lands while we are paging must
    // still look like movement to the next sweep, or the last turn of a burst is the
    // one the watch never sees.
    const lease = this.transcriptLeases.get(agentId);
    if (lease) {
      lease.lastActivityAt =
        lastActivityIndex(this.deps.readState()).get(activityKey(serverId, agentId)) ?? null;
    }

    const client = this.deps.getClient(serverId);
    if (!client) {
      this.deps.logger?.warn(`No client for server ${serverId}; dropping wear transcript request`);
      return;
    }

    // Commands run concurrently, so two requests for the same agent race. Without a
    // generation the winner is whichever fetch finishes last, which means a slow
    // older fetch can overwrite a newer transcript with staler content.
    const generation = (this.transcriptGenerations.get(agentId) ?? 0) + 1;
    this.transcriptGenerations.set(agentId, generation);

    let pages: TimelinePage[];
    try {
      pages = await fetchTranscriptPages(client, agentId);
    } catch (error) {
      // Publishing nothing leaves the watch on its loading state, which is honest —
      // an empty transcript would read as "this agent has said nothing".
      this.deps.logger?.warn(`Failed to fetch transcript for agent ${agentId}`, error);
      return;
    }

    const transcript = buildWearTranscript(
      {
        agentId,
        serverId,
        items: pages.flatMap((page) => page.entries.map((entry) => entry.item)),
        // The oldest page we reached decides whether anything is still behind us.
        hasOlder: pages[0]?.hasOlder ?? false,
      },
      this.deps.now?.() ?? Date.now(),
    );

    if (this.transcriptGenerations.get(agentId) !== generation) {
      // A newer request for this agent already published; this result is older than
      // what the watch is showing, so landing it would be a visible regression.
      return;
    }

    await this.deps.transport
      .publishTranscript(agentId, JSON.stringify(transcript))
      .catch((error: unknown) => {
        this.deps.logger?.warn(`Failed to publish wear transcript for agent ${agentId}`, error);
        return false;
      });
  }

  async execute(command: WearCommand): Promise<void> {
    if (command.kind === "refresh") {
      await this.publish({ force: true });
      return;
    }

    if (command.kind === "requestTranscript") {
      // The request is also the watch saying "I am looking at this now". Holding a
      // lease is what turns the next minute of activity into pushed updates instead
      // of the watch waiting for its own next poll.
      this.renewTranscriptLease(command.serverId, command.agentId, this.deps.now?.() ?? Date.now());
      // Returns without the forced republish below: reading a transcript changes
      // nothing about the agent, so there is no new state for the snapshot to carry.
      await this.publishTranscript(command.serverId, command.agentId);
      return;
    }

    const client = this.deps.getClient(command.serverId);
    if (!client) {
      // The watch already reported the send as delivered; there is nothing useful to
      // show it from here, so this is a log-and-drop. The next snapshot will show the
      // unchanged state, which is the honest outcome.
      this.deps.logger?.warn(`No client for server ${command.serverId}; dropping wear command`);
      return;
    }

    try {
      switch (command.kind) {
        case "sendPrompt":
          await client.sendAgentMessage(command.agentId, command.text);
          break;
        case "createAgent": {
          const config = this.deps.resolveNewAgentConfig(command.serverId, command.workspaceId);
          if (!config) {
            this.deps.logger?.warn(
              `No provider for workspace ${command.workspaceId}; dropping wear createAgent`,
            );
            break;
          }
          await client.createAgent({
            workspaceId: command.workspaceId,
            provider: config.provider as Parameters<DaemonClient["createAgent"]>[0]["provider"],
            cwd: config.cwd,
            initialPrompt: command.text,
          });
          break;
        }
        case "respondPermission":
          await client.respondToPermission(
            command.agentId,
            command.requestId,
            command.allow ? { behavior: "allow" } : { behavior: "deny" },
          );
          break;
        case "stopAgent":
          await client.cancelAgent(command.agentId);
          break;
      }
    } catch (error) {
      this.deps.logger?.warn(`Wear command ${command.kind} failed`, error);
    }

    // Push the resulting state promptly rather than waiting for the next store tick,
    // so the wrist reflects the action it just took.
    await this.publish({ force: true });
  }
}

/** Agent ids are only unique within a server, so leases are compared per server. */
function activityKey(serverId: string, agentId: string): string {
  return `${serverId} ${agentId}`;
}

function lastActivityIndex(state: WearSnapshotInput[]): Map<string, number> {
  const index = new Map<string, number>();
  for (const input of state) {
    for (const agent of input.agents) {
      index.set(activityKey(input.serverId, agent.id), agent.lastActivityAt.getTime());
    }
  }
  return index;
}

type TimelineClient = Pick<DaemonClient, "fetchAgentTimeline">;
type TimelinePage = Awaited<ReturnType<TimelineClient["fetchAgentTimeline"]>>;

/**
 * Walk backwards from the tail until we have enough entries, run out of history, or
 * hit the request cap. Returned oldest page first.
 *
 * Counts only entries that survive projection. Raw daemon entries would overcount a
 * reasoning-heavy history badly — a page can be almost entirely reasoning and todos,
 * none of which reaches the watch — and the walk would stop with a nearly empty
 * transcript while it still had requests left to spend.
 */
async function fetchTranscriptPages(
  client: TimelineClient,
  agentId: string,
): Promise<TimelinePage[]> {
  const pages: TimelinePage[] = [];
  let total = 0;
  let epoch: string | null = null;

  for (let request = 0; request < MAX_TRANSCRIPT_REQUESTS; request += 1) {
    // The first request omits the cursor entirely: that is what asks for the tail.
    const cursor = pages[0]?.startCursor;
    const page = await client.fetchAgentTimeline(
      agentId,
      cursor
        ? { projection: "projected", direction: "before", cursor, limit: TRANSCRIPT_PAGE_SIZE }
        : { projection: "projected", limit: TRANSCRIPT_PAGE_SIZE },
    );

    if (epoch === null) {
      epoch = page.epoch;
    } else if (page.reset || page.staleCursor || page.epoch !== epoch) {
      // The timeline was rewound or rehydrated mid-walk, so our cursor is pointing
      // into a history that no longer exists and the daemon answered with a fresh
      // tail instead. Splicing that onto what we already have would duplicate turns
      // and resurrect rewound-away content, so stop and keep the consistent prefix.
      break;
    }

    pages.unshift(page);
    total += page.entries.filter((entry) => isTranscriptEntry(entry.item)).length;

    if (total >= MAX_TRANSCRIPT_ENTRIES || !page.hasOlder || !page.startCursor) break;
  }

  return pages;
}

/**
 * Identity key for change detection. Excludes `updatedAt`, which changes on every
 * build and would defeat the comparison entirely.
 */
function stableSnapshotKey(snapshot: WearSnapshot): string {
  return JSON.stringify({ v: snapshot.v, workspaces: snapshot.workspaces });
}

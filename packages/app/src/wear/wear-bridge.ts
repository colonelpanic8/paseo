import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";

import { parseWearCommand, type WearCommand, type WearSnapshot } from "./wear-protocol";
import { buildWearSnapshot, type WearSnapshotInput } from "./wear-snapshot";

export interface WearBridgeTransport {
  publishSnapshot(payload: string): Promise<boolean>;
  addCommandListener(listener: (payload: string) => void): { remove(): void };
  drainPendingCommands(): Promise<string[]>;
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
    const snapshot = buildWearSnapshot(this.deps.readState(), now);
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

  private async handleCommandPayload(payload: string): Promise<void> {
    const command = parseWearCommand(payload);
    if (!command) {
      this.deps.logger?.warn(`Ignoring unparseable wear command: ${payload.slice(0, 120)}`);
      return;
    }
    await this.execute(command);
  }

  async execute(command: WearCommand): Promise<void> {
    if (command.kind === "refresh") {
      await this.publish({ force: true });
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

/**
 * Identity key for change detection. Excludes `updatedAt`, which changes on every
 * build and would defeat the comparison entirely.
 */
function stableSnapshotKey(snapshot: WearSnapshot): string {
  return JSON.stringify({ v: snapshot.v, workspaces: snapshot.workspaces });
}

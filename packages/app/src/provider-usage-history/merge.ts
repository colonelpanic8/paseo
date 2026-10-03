/**
 * Merges one usage-history payload per host into a single report.
 *
 * Two daemons can read the same physical transcript directory — two hosts on
 * one machine, or a shared home over the network — and summing them would
 * double every token in it. A source is fingerprinted by
 * `(hostId, provider, path, volumeId)`; the first host in serverId order to
 * report a fingerprint claims it, and a later host reporting the same one has
 * that source's buckets dropped. Hostname alone is not enough, because every
 * Mac in a fleet resolves `/Users/<user>/.claude`.
 *
 * A daemon that predates the fingerprint sends neither field. Such a source
 * can never be proven a duplicate, so it is always counted.
 *
 * @module merge
 */
import { deriveProviderUsageHistory, type ProviderUsageHistoryTotals } from "./derive";
import type { ProviderUsageHistoryPayload, ProviderUsageHistorySource } from "./types";

export type ProviderUsageHistoryHostStatus =
  /** Fetching, with nothing to show yet. */
  | "pending"
  /** Reported a payload. */
  | "ready"
  /** The read failed. */
  | "error"
  /** Not connected. */
  | "offline"
  /** Connected, but too old to answer. */
  | "unsupported";

export interface ProviderUsageHistoryHostInput {
  readonly serverId: string;
  readonly hostName: string;
  readonly status: ProviderUsageHistoryHostStatus;
  readonly payload?: ProviderUsageHistoryPayload;
}

export interface ProviderUsageHistoryReport extends ProviderUsageHistoryTotals {
  /** `"<host>: <path>"` per source dropped because another host reads the same directory. */
  readonly duplicates: readonly string[];
}

function sourceFingerprint(source: ProviderUsageHistorySource): string | null {
  const hostId = source.hostId ?? "";
  const volumeId = source.volumeId ?? "";
  if (hostId === "" || volumeId === "") return null;
  return JSON.stringify([hostId, source.provider, source.path, volumeId]);
}

export function mergeProviderUsageHistory(
  hosts: readonly ProviderUsageHistoryHostInput[],
): ProviderUsageHistoryReport {
  const contributors = hosts
    .flatMap((host) => (host.payload ? [{ ...host, payload: host.payload }] : []))
    .sort((left, right) => left.serverId.localeCompare(right.serverId));

  const claimed = new Set<string>();
  const duplicates: string[] = [];

  const payloads = contributors.map((host) => ({
    serverId: host.serverId,
    hostName: host.hostName,
    payload: host.payload,
    countedSources: host.payload.sources.filter((source) => {
      // A home the daemon never found proves nothing about who owns the
      // directory, so it neither claims a fingerprint nor loses to one.
      if (source.status === "missing") return true;
      const fingerprint = sourceFingerprint(source);
      if (fingerprint === null) return true;
      if (claimed.has(fingerprint)) {
        duplicates.push(`${host.hostName}: ${source.path}`);
        return false;
      }
      claimed.add(fingerprint);
      return true;
    }),
  }));

  return { ...deriveProviderUsageHistory(payloads), duplicates };
}

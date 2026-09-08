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

/**
 * Hosts whose transcripts another host already reported. Grouped by the host
 * that claimed them, because the page says it in one sentence: listing every
 * dropped directory produced a line nobody could read past.
 */
export interface ProviderUsageHistoryDuplicateHosts {
  readonly hostNames: readonly string[];
  readonly claimedByHostName: string;
}

export interface ProviderUsageHistoryReport extends ProviderUsageHistoryTotals {
  readonly duplicates: readonly ProviderUsageHistoryDuplicateHosts[];
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

  const claimed = new Map<string, string>();
  // Claimant host name -> the hosts that lost a source to it, in first-seen order.
  const losers = new Map<string, string[]>();

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
      const claimant = claimed.get(fingerprint);
      if (claimant !== undefined) {
        const group = losers.get(claimant) ?? [];
        if (!group.includes(host.hostName)) group.push(host.hostName);
        losers.set(claimant, group);
        return false;
      }
      claimed.set(fingerprint, host.hostName);
      return true;
    }),
  }));

  const duplicates = [...losers.entries()].map(([claimedByHostName, hostNames]) => ({
    hostNames,
    claimedByHostName,
  }));

  return { ...deriveProviderUsageHistory(payloads), duplicates };
}

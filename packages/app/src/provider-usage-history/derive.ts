/**
 * Turns the daemon's `(day, provider, model)` buckets into the totals the page
 * renders. Takes one entry per contributing host, so a single host is the
 * length-1 case of the multi-host merge. Pure, so the token and share
 * arithmetic is testable without a host.
 *
 * @module derive
 */
import { orderProviders, providerLabel } from "./providers";
import type {
  ProviderUsageHistoryBucket,
  ProviderUsageHistoryPayload,
  ProviderUsageHistorySource,
} from "./types";

/**
 * One host's contribution. `countedSources` omits any source another host has
 * already claimed, so a transcript directory two daemons can both see is added
 * once; `merge.ts` decides which host claims it.
 */
export interface ProviderUsageHistoryHostPayload {
  readonly serverId: string;
  readonly hostName: string;
  readonly payload: ProviderUsageHistoryPayload;
  readonly countedSources: readonly ProviderUsageHistorySource[];
}

export interface ProviderUsageHistoryValue {
  readonly costUsd: number;
  readonly unpricedRecords: number;
  readonly totalTokens: number;
}

export interface ProviderUsageHistoryProviderTotals extends ProviderUsageHistoryValue {
  readonly provider: string;
  readonly records: number;
  readonly sessions: number;
  readonly costShare: number;
  readonly tokenShare: number;
}

/**
 * One configured provider's slice of its base kind. A user can extend a
 * built-in provider several times, each with its own credentials and transcript
 * home, so `codex` may be three configured providers at once — and two hosts
 * each running their own `codex` are two more.
 */
export interface ProviderUsageHistoryConfiguredTotals extends ProviderUsageHistoryValue {
  /** Unique in the report: the configured provider id, host-qualified once more than one host contributes. */
  readonly id: string;
  /** Configured provider id, e.g. `codex-colonel`. Equals `provider` on daemons that predate multi-home scanning. */
  readonly providerId: string;
  readonly serverId: string;
  /** Base kind this provider extends. Groups these rows and owns the series color. */
  readonly provider: string;
  /** Carries the host name once more than one host contributes. */
  readonly label: string;
  readonly records: number;
  readonly sessions: number;
  readonly costShare: number;
  readonly tokenShare: number;
}

export interface ProviderUsageHistoryHostTotals extends ProviderUsageHistoryValue {
  readonly serverId: string;
  readonly name: string;
  readonly records: number;
  readonly sessions: number;
  readonly costShare: number;
  readonly tokenShare: number;
}

export interface ProviderUsageHistoryModelTotals extends ProviderUsageHistoryValue {
  readonly provider: string;
  readonly model: string;
  readonly records: number;
  readonly costShare: number;
}

export interface ProviderUsageHistoryDayTotals extends ProviderUsageHistoryValue {
  readonly day: string;
  readonly byProvider: ReadonlyMap<string, ProviderUsageHistoryValue>;
}

export interface ProviderUsageHistoryTotals {
  readonly costUsd: number;
  readonly unpricedRecords: number;
  readonly totalTokens: number;
  readonly uncachedInputTokens: number;
  readonly cachedInputTokens: number;
  readonly cacheCreationTokens: number;
  readonly outputTokens: number;
  readonly sessions: number;
  readonly cacheSavingsUsd: number;
  /**
   * Canonical order of every provider the window could contain, including ones
   * with no activity. Indexes into this list pick a series color, so a provider
   * keeps its color across windows.
   */
  readonly providerOrder: readonly string[];
  /** In {@link ProviderUsageHistoryTotals.providerOrder}, activity only. */
  readonly providers: readonly ProviderUsageHistoryProviderTotals[];
  /**
   * The same activity split by configured provider, in base-kind order and then
   * cost descending. One entry per kind when the user extends no built-in.
   */
  readonly configuredProviders: readonly ProviderUsageHistoryConfiguredTotals[];
  /** One entry per host that contributed a counted source, cost descending. */
  readonly hosts: readonly ProviderUsageHistoryHostTotals[];
  /**
   * Labels of configured providers whose transcript home could not be read.
   * Their tokens are missing from every total above, so the page has to say so.
   */
  readonly unreadableProviders: readonly string[];
  /** A contributing host has no rate table, so part of the cost is missing. */
  readonly pricingUnavailable: boolean;
  readonly models: readonly ProviderUsageHistoryModelTotals[];
  readonly daily: readonly ProviderUsageHistoryDayTotals[];
}

interface MutableValue {
  costUsd: number;
  unpricedRecords: number;
  totalTokens: number;
}

interface MutableProvider extends MutableValue {
  records: number;
  sessions: number;
}

interface MutableConfigured extends MutableValue {
  providerId: string;
  serverId: string;
  provider: string;
  label: string;
  records: number;
  sessions: number;
}

interface MutableHost extends MutableValue {
  serverId: string;
  name: string;
  records: number;
  sessions: number;
}

interface MutableModel extends MutableValue {
  provider: string;
  model: string;
  records: number;
}

interface MutableDay extends MutableValue {
  byProvider: Map<string, MutableValue>;
}

/** `reasoningTokens` is a subset of `outputTokens` and must not be added again. */
function bucketTokens(bucket: ProviderUsageHistoryBucket): number {
  return (
    bucket.totals.uncachedInputTokens +
    bucket.totals.cachedInputTokens +
    bucket.totals.cacheCreationTokens +
    bucket.totals.outputTokens
  );
}

/** A daemon that predates multi-home scanning reports only the base kind's home. */
export function sourceProviderId(source: ProviderUsageHistorySource): string {
  return source.providerId ?? source.provider;
}

function sourceLabel(source: ProviderUsageHistorySource): string {
  return source.label ?? providerLabel(source.provider);
}

function emptyValue(): MutableValue {
  return { costUsd: 0, unpricedRecords: 0, totalTokens: 0 };
}

function addBucket(target: MutableValue, bucket: ProviderUsageHistoryBucket, tokens: number): void {
  target.costUsd += bucket.costUsd;
  target.unpricedRecords += bucket.unpricedRecords;
  target.totalTokens += tokens;
}

export function deriveProviderUsageHistory(
  hosts: readonly ProviderUsageHistoryHostPayload[],
): ProviderUsageHistoryTotals {
  // A host whose every source was claimed by another host contributed nothing;
  // it is named in the coverage line, and a zero row for it is noise.
  const contributing = hosts.filter((host) => host.countedSources.length > 0);
  // With one contributor the ids and labels stay exactly what that daemon reports.
  const isMultiHost = contributing.length > 1;

  let costUsd = 0;
  let unpricedRecords = 0;
  let cacheSavingsUsd = 0;
  let uncachedInputTokens = 0;
  let cachedInputTokens = 0;
  let cacheCreationTokens = 0;
  let outputTokens = 0;
  let pricingUnavailable = false;

  const providerAccumulator = new Map<string, MutableProvider>();
  const configuredAccumulator = new Map<string, MutableConfigured>();
  const hostAccumulator = new Map<string, MutableHost>();
  const modelAccumulator = new Map<string, MutableModel>();
  const dayAccumulator = new Map<string, MutableDay>();
  const unreadableProviders = new Set<string>();

  function ensureProvider(provider: string): MutableProvider {
    const existing = providerAccumulator.get(provider);
    if (existing) return existing;
    const created: MutableProvider = { ...emptyValue(), records: 0, sessions: 0 };
    providerAccumulator.set(provider, created);
    return created;
  }

  function ensureConfigured(
    serverId: string,
    providerId: string,
    provider: string,
    label: string,
  ): MutableConfigured {
    const key = `${serverId}\u0000${providerId}`;
    const existing = configuredAccumulator.get(key);
    if (existing) return existing;
    const created: MutableConfigured = {
      ...emptyValue(),
      providerId,
      serverId,
      provider,
      label,
      records: 0,
      sessions: 0,
    };
    configuredAccumulator.set(key, created);
    return created;
  }

  for (const host of contributing) {
    if (host.payload.pricing.status === "unavailable") pricingUnavailable = true;

    const hostTotals: MutableHost = {
      ...emptyValue(),
      serverId: host.serverId,
      name: host.hostName,
      records: 0,
      sessions: 0,
    };
    hostAccumulator.set(host.serverId, hostTotals);

    const countedProviderIds = new Set(host.countedSources.map(sourceProviderId));
    // A source another host already claimed takes its buckets with it, or the
    // same physical transcript directory lands in the totals twice.
    const droppedProviderIds = new Set(
      host.payload.sources
        .map(sourceProviderId)
        .filter((providerId) => !countedProviderIds.has(providerId)),
    );

    for (const source of host.countedSources) {
      // Sessions come from the sources, not the buckets: a session that spans
      // two days and three models is counted once per `(day, model)` cell.
      ensureProvider(source.provider).sessions += source.distinctSessions;
      hostTotals.sessions += source.distinctSessions;
      const configured = ensureConfigured(
        host.serverId,
        sourceProviderId(source),
        source.provider,
        sourceLabel(source),
      );
      configured.sessions += source.distinctSessions;
      if (source.status === "failed") {
        unreadableProviders.add(
          isMultiHost ? `${configured.label} on ${host.hostName}` : configured.label,
        );
      }
    }

    for (const bucket of host.payload.buckets) {
      const providerId = bucket.providerId ?? bucket.provider;
      if (droppedProviderIds.has(providerId)) continue;

      const tokens = bucketTokens(bucket);
      costUsd += bucket.costUsd;
      unpricedRecords += bucket.unpricedRecords;
      cacheSavingsUsd += bucket.cacheSavingsUsd;
      uncachedInputTokens += bucket.totals.uncachedInputTokens;
      cachedInputTokens += bucket.totals.cachedInputTokens;
      cacheCreationTokens += bucket.totals.cacheCreationTokens;
      outputTokens += bucket.totals.outputTokens;

      const provider = ensureProvider(bucket.provider);
      addBucket(provider, bucket, tokens);
      provider.records += bucket.records;

      const configured = ensureConfigured(
        host.serverId,
        providerId,
        bucket.provider,
        providerLabel(providerId),
      );
      addBucket(configured, bucket, tokens);
      configured.records += bucket.records;

      addBucket(hostTotals, bucket, tokens);
      hostTotals.records += bucket.records;

      const modelKey = `${bucket.provider}\u0000${bucket.model}`;
      const model = modelAccumulator.get(modelKey) ?? {
        ...emptyValue(),
        provider: bucket.provider,
        model: bucket.model,
        records: 0,
      };
      addBucket(model, bucket, tokens);
      model.records += bucket.records;
      modelAccumulator.set(modelKey, model);

      const day = dayAccumulator.get(bucket.day) ?? {
        ...emptyValue(),
        byProvider: new Map<string, MutableValue>(),
      };
      addBucket(day, bucket, tokens);
      const dayProvider = day.byProvider.get(bucket.provider) ?? emptyValue();
      addBucket(dayProvider, bucket, tokens);
      day.byProvider.set(bucket.provider, dayProvider);
      dayAccumulator.set(bucket.day, day);
    }
  }

  const totalTokens = uncachedInputTokens + cachedInputTokens + cacheCreationTokens + outputTokens;

  // Over priced cost, which is the only cost there is: an unpriced record adds
  // nothing to either side of the ratio. The footnote owns the caveat.
  function costShare(subtotal: number): number {
    return costUsd === 0 ? 0 : subtotal / costUsd;
  }

  function tokenShare(subtotal: number): number {
    return totalTokens === 0 ? 0 : subtotal / totalTokens;
  }

  function hasActivity(totals: MutableValue & { sessions: number }): boolean {
    return totals.totalTokens > 0 || totals.costUsd > 0 || totals.sessions > 0;
  }

  const providerOrder = orderProviders(providerAccumulator.keys());
  const providers = providerOrder.flatMap((provider) => {
    const totals = providerAccumulator.get(provider);
    if (totals === undefined || !hasActivity(totals)) return [];
    return [
      {
        provider,
        costUsd: totals.costUsd,
        unpricedRecords: totals.unpricedRecords,
        totalTokens: totals.totalTokens,
        records: totals.records,
        sessions: totals.sessions,
        costShare: costShare(totals.costUsd),
        tokenShare: tokenShare(totals.totalTokens),
      },
    ];
  });

  const kindRank = new Map<string, number>(
    providerOrder.map((provider, index) => [provider, index] as const),
  );
  const configuredProviders = [...configuredAccumulator.values()]
    .flatMap((totals) => {
      if (!hasActivity(totals)) return [];
      return [
        {
          id: isMultiHost ? `${totals.serverId}:${totals.providerId}` : totals.providerId,
          providerId: totals.providerId,
          serverId: totals.serverId,
          provider: totals.provider,
          label: isMultiHost
            ? `${totals.label} · ${hostAccumulator.get(totals.serverId)?.name ?? totals.serverId}`
            : totals.label,
          costUsd: totals.costUsd,
          unpricedRecords: totals.unpricedRecords,
          totalTokens: totals.totalTokens,
          records: totals.records,
          sessions: totals.sessions,
          costShare: costShare(totals.costUsd),
          tokenShare: tokenShare(totals.totalTokens),
        },
      ];
    })
    .sort(
      (left, right) =>
        (kindRank.get(left.provider) ?? providerOrder.length) -
          (kindRank.get(right.provider) ?? providerOrder.length) ||
        right.costUsd - left.costUsd ||
        right.totalTokens - left.totalTokens ||
        left.id.localeCompare(right.id),
    );

  // One row per host that still owned a source after dedupe, including a host
  // that owned one and used it for nothing: "counted, and idle" is an answer.
  const hostTotals = [...hostAccumulator.values()]
    .map((totals) => ({
      serverId: totals.serverId,
      name: totals.name,
      costUsd: totals.costUsd,
      unpricedRecords: totals.unpricedRecords,
      totalTokens: totals.totalTokens,
      records: totals.records,
      sessions: totals.sessions,
      costShare: costShare(totals.costUsd),
      tokenShare: tokenShare(totals.totalTokens),
    }))
    .sort(
      (left, right) =>
        right.costUsd - left.costUsd ||
        right.totalTokens - left.totalTokens ||
        left.name.localeCompare(right.name),
    );

  const models = [...modelAccumulator.values()]
    .map((totals) => ({
      provider: totals.provider,
      model: totals.model,
      costUsd: totals.costUsd,
      unpricedRecords: totals.unpricedRecords,
      totalTokens: totals.totalTokens,
      records: totals.records,
      costShare: costShare(totals.costUsd),
    }))
    .sort((left, right) => right.costUsd - left.costUsd || right.totalTokens - left.totalTokens);

  const daily = [...dayAccumulator.entries()]
    .map(([day, totals]) => ({
      day,
      costUsd: totals.costUsd,
      unpricedRecords: totals.unpricedRecords,
      totalTokens: totals.totalTokens,
      byProvider: totals.byProvider as ReadonlyMap<string, ProviderUsageHistoryValue>,
    }))
    .sort((left, right) => left.day.localeCompare(right.day));

  const sessions = [...hostAccumulator.values()].reduce((sum, host) => sum + host.sessions, 0);

  return {
    costUsd,
    unpricedRecords,
    totalTokens,
    uncachedInputTokens,
    cachedInputTokens,
    cacheCreationTokens,
    outputTokens,
    sessions,
    cacheSavingsUsd,
    providerOrder,
    providers,
    configuredProviders,
    hosts: hostTotals,
    unreadableProviders: [...unreadableProviders],
    pricingUnavailable,
    models,
    daily,
  };
}

/**
 * Groups the configured providers under their base kind, preserving the
 * cost-descending order inside each group.
 */
export function configuredProvidersByKind(
  configuredProviders: readonly ProviderUsageHistoryConfiguredTotals[],
): ReadonlyMap<string, readonly ProviderUsageHistoryConfiguredTotals[]> {
  const grouped = new Map<string, ProviderUsageHistoryConfiguredTotals[]>();
  for (const entry of configuredProviders) {
    const existing = grouped.get(entry.provider);
    if (existing === undefined) grouped.set(entry.provider, [entry]);
    else existing.push(entry);
  }
  return grouped;
}

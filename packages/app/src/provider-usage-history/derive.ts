/**
 * Turns the daemon's `(day, provider, model)` buckets into the totals the page
 * renders. Pure, so the token and share arithmetic is testable without a host.
 *
 * @module derive
 */
import { orderProviders, providerLabel } from "./providers";
import type {
  ProviderUsageHistoryBucket,
  ProviderUsageHistoryPayload,
  ProviderUsageHistorySource,
} from "./types";

export interface ProviderUsageHistoryValue {
  readonly costUsd: number;
  readonly unpricedRecords: number;
  readonly totalTokens: number;
}

export interface ProviderUsageHistoryProviderTotals extends ProviderUsageHistoryValue {
  readonly provider: string;
  readonly records: number;
  readonly sessions: number;
  readonly costShare: number | null;
  readonly tokenShare: number;
}

/**
 * One configured provider's slice of its base kind. A user can extend a
 * built-in provider several times, each with its own credentials and transcript
 * home, so `codex` may be three configured providers at once.
 */
export interface ProviderUsageHistoryConfiguredTotals extends ProviderUsageHistoryValue {
  /** Configured provider id, e.g. `codex-colonel`. Equals `provider` on daemons that predate multi-home scanning. */
  readonly providerId: string;
  /** Base kind this provider extends. Groups these rows and owns the series color. */
  readonly provider: string;
  readonly label: string;
  readonly records: number;
  readonly sessions: number;
  readonly costShare: number | null;
  readonly tokenShare: number;
}

export interface ProviderUsageHistoryModelTotals extends ProviderUsageHistoryValue {
  readonly provider: string;
  readonly model: string;
  readonly records: number;
  readonly costShare: number | null;
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
  /**
   * Labels of configured providers whose transcript home could not be read.
   * Their tokens are missing from every total above, so the page has to say so.
   */
  readonly unreadableProviders: readonly string[];
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
  provider: string;
  label: string;
  records: number;
  sessions: number;
}

interface MutableModel extends MutableValue {
  provider: string;
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
function sourceProviderId(source: ProviderUsageHistorySource): string {
  return source.providerId ?? source.provider;
}

function sourceLabel(source: ProviderUsageHistorySource): string {
  return source.label ?? providerLabel(source.provider);
}

/**
 * Sessions come from the sources, not the buckets: a session that spans two
 * days and three models is counted once per `(day, model)` cell.
 */
function sessionsByProvider(
  sources: readonly ProviderUsageHistorySource[],
): ReadonlyMap<string, number> {
  const counts = new Map<string, number>();
  for (const source of sources) {
    counts.set(source.provider, (counts.get(source.provider) ?? 0) + source.distinctSessions);
  }
  return counts;
}

function emptyValue(): MutableValue {
  return { costUsd: 0, unpricedRecords: 0, totalTokens: 0 };
}

export function deriveProviderUsageHistory(
  payload: ProviderUsageHistoryPayload,
): ProviderUsageHistoryTotals {
  let costUsd = 0;
  let unpricedRecords = 0;
  let cacheSavingsUsd = 0;
  let uncachedInputTokens = 0;
  let cachedInputTokens = 0;
  let cacheCreationTokens = 0;
  let outputTokens = 0;

  const providerAccumulator = new Map<string, MutableProvider>();
  const configuredAccumulator = new Map<string, MutableConfigured>();
  const modelAccumulator = new Map<string, MutableModel>();
  const dayAccumulator = new Map<string, MutableDay>();

  const sessionCounts = sessionsByProvider(payload.sources);
  for (const [provider, sessions] of sessionCounts) {
    providerAccumulator.set(provider, {
      costUsd: 0,
      unpricedRecords: 0,
      totalTokens: 0,
      records: 0,
      sessions,
    });
  }

  for (const source of payload.sources) {
    const providerId = sourceProviderId(source);
    const existing = configuredAccumulator.get(providerId);
    if (existing === undefined) {
      configuredAccumulator.set(providerId, {
        provider: source.provider,
        label: sourceLabel(source),
        costUsd: 0,
        unpricedRecords: 0,
        totalTokens: 0,
        records: 0,
        sessions: source.distinctSessions,
      });
    } else {
      existing.sessions += source.distinctSessions;
    }
  }

  for (const bucket of payload.buckets) {
    const tokens = bucketTokens(bucket);

    costUsd += bucket.costUsd;
    unpricedRecords += bucket.unpricedRecords;
    cacheSavingsUsd += bucket.cacheSavingsUsd;
    uncachedInputTokens += bucket.totals.uncachedInputTokens;
    cachedInputTokens += bucket.totals.cachedInputTokens;
    cacheCreationTokens += bucket.totals.cacheCreationTokens;
    outputTokens += bucket.totals.outputTokens;

    const provider = providerAccumulator.get(bucket.provider) ?? {
      costUsd: 0,
      unpricedRecords: 0,
      totalTokens: 0,
      records: 0,
      sessions: 0,
    };
    provider.costUsd += bucket.costUsd;
    provider.unpricedRecords += bucket.unpricedRecords;
    provider.totalTokens += tokens;
    provider.records += bucket.records;
    providerAccumulator.set(bucket.provider, provider);

    const providerId = bucket.providerId ?? bucket.provider;
    const configured = configuredAccumulator.get(providerId) ?? {
      provider: bucket.provider,
      label: providerLabel(providerId),
      costUsd: 0,
      unpricedRecords: 0,
      totalTokens: 0,
      records: 0,
      sessions: 0,
    };
    configured.costUsd += bucket.costUsd;
    configured.unpricedRecords += bucket.unpricedRecords;
    configured.totalTokens += tokens;
    configured.records += bucket.records;
    configuredAccumulator.set(providerId, configured);

    const modelKey = `${bucket.provider}\u0000${bucket.model}`;
    const model = modelAccumulator.get(modelKey) ?? {
      provider: bucket.provider,
      costUsd: 0,
      unpricedRecords: 0,
      totalTokens: 0,
      records: 0,
    };
    model.costUsd += bucket.costUsd;
    model.unpricedRecords += bucket.unpricedRecords;
    model.totalTokens += tokens;
    model.records += bucket.records;
    modelAccumulator.set(modelKey, model);

    const day = dayAccumulator.get(bucket.day) ?? {
      costUsd: 0,
      unpricedRecords: 0,
      totalTokens: 0,
      byProvider: new Map<string, MutableValue>(),
    };
    day.costUsd += bucket.costUsd;
    day.unpricedRecords += bucket.unpricedRecords;
    day.totalTokens += tokens;
    const dayProvider = day.byProvider.get(bucket.provider) ?? emptyValue();
    dayProvider.costUsd += bucket.costUsd;
    dayProvider.unpricedRecords += bucket.unpricedRecords;
    dayProvider.totalTokens += tokens;
    day.byProvider.set(bucket.provider, dayProvider);
    dayAccumulator.set(bucket.day, day);
  }

  const totalTokens = uncachedInputTokens + cachedInputTokens + cacheCreationTokens + outputTokens;

  function costShare(subtotal: number): number | null {
    if (unpricedRecords > 0) return null;
    return costUsd === 0 ? 0 : subtotal / costUsd;
  }

  const providerOrder = orderProviders(providerAccumulator.keys());
  const providers = providerOrder.flatMap((provider) => {
    const totals = providerAccumulator.get(provider);
    if (totals === undefined) return [];
    const hasActivity = totals.totalTokens > 0 || totals.costUsd > 0 || totals.sessions > 0;
    if (!hasActivity) return [];
    return [
      {
        provider,
        costUsd: totals.costUsd,
        unpricedRecords: totals.unpricedRecords,
        totalTokens: totals.totalTokens,
        records: totals.records,
        sessions: totals.sessions,
        costShare: costShare(totals.costUsd),
        tokenShare: totalTokens === 0 ? 0 : totals.totalTokens / totalTokens,
      },
    ];
  });

  const kindRank = new Map<string, number>(
    providerOrder.map((provider, index) => [provider, index] as const),
  );
  const configuredProviders = [...configuredAccumulator.entries()]
    .flatMap(([providerId, totals]) => {
      const hasActivity = totals.totalTokens > 0 || totals.costUsd > 0 || totals.sessions > 0;
      if (!hasActivity) return [];
      return [
        {
          providerId,
          provider: totals.provider,
          label: totals.label,
          costUsd: totals.costUsd,
          unpricedRecords: totals.unpricedRecords,
          totalTokens: totals.totalTokens,
          records: totals.records,
          sessions: totals.sessions,
          costShare: costShare(totals.costUsd),
          tokenShare: totalTokens === 0 ? 0 : totals.totalTokens / totalTokens,
        },
      ];
    })
    .sort(
      (left, right) =>
        (kindRank.get(left.provider) ?? providerOrder.length) -
          (kindRank.get(right.provider) ?? providerOrder.length) ||
        right.costUsd - left.costUsd ||
        right.totalTokens - left.totalTokens ||
        left.providerId.localeCompare(right.providerId),
    );

  const unreadableProviders = [
    ...new Set(payload.sources.filter((source) => source.status === "failed").map(sourceLabel)),
  ];

  const models = [...modelAccumulator.entries()]
    .map(([key, totals]) => ({
      provider: totals.provider,
      model: key.slice(key.indexOf("\u0000") + 1),
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

  const sessions = [...sessionCounts.values()].reduce((sum, count) => sum + count, 0);

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
    unreadableProviders,
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

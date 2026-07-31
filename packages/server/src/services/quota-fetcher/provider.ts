import type { Logger } from "pino";
import type { ProviderUsage } from "../../server/messages.js";

export type ProviderApiFetch = typeof fetch;

export interface ProviderUsageFetcher {
  readonly providerId: string;
  readonly displayName: string;
  fetchUsage(): Promise<ProviderUsage>;
}

export interface ProviderUsageFetcherFactoryOptions {
  logger: Logger;
  fetch?: ProviderApiFetch;
  /**
   * Read credentials from this account directory instead of the provider's
   * default one. Only set when building a fetcher for a configured account.
   */
  accountConfigDir?: string;
}

export interface ProviderUsageFetcherManifestEntry {
  readonly providerId: string;
  create(options: ProviderUsageFetcherFactoryOptions): ProviderUsageFetcher;
}

/**
 * Re-labels a fetcher as one account of its provider, so two accounts show up
 * as two rows instead of collapsing onto the base provider's id.
 */
export function withProviderUsageIdentity(
  fetcher: ProviderUsageFetcher,
  identity: { providerId: string; displayName: string },
): ProviderUsageFetcher {
  return {
    providerId: identity.providerId,
    displayName: identity.displayName,
    async fetchUsage(): Promise<ProviderUsage> {
      const usage = await fetcher.fetchUsage();
      return { ...usage, providerId: identity.providerId, displayName: identity.displayName };
    },
  };
}

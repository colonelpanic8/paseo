import type { ProviderAccountProfile } from "../../server/daemon-config-store.js";
import {
  withProviderUsageIdentity,
  type ProviderUsageFetcher,
  type ProviderUsageFetcherFactoryOptions,
  type ProviderUsageFetcherManifestEntry,
} from "./provider.js";
import { ClaudeQuotaProvider } from "./providers/claude.js";
import { CodexQuotaProvider } from "./providers/codex.js";
import { CopilotQuotaProvider } from "./providers/copilot.js";
import { CursorQuotaProvider } from "./providers/cursor.js";
import { GrokQuotaProvider } from "./providers/grok.js";
import { KimiQuotaProvider } from "./providers/kimi.js";
import { MiniMaxQuotaProvider } from "./providers/minimax.js";
import { ZaiQuotaProvider } from "./providers/zai.js";

export const PROVIDER_USAGE_FETCHERS: readonly ProviderUsageFetcherManifestEntry[] = [
  {
    providerId: "claude",
    create: (options) =>
      new ClaudeQuotaProvider({
        logger: options.logger,
        fetch: options.fetch,
        accountConfigDir: options.accountConfigDir,
      }),
  },
  {
    providerId: "codex",
    create: (options) =>
      new CodexQuotaProvider({
        logger: options.logger,
        fetch: options.fetch,
        accountConfigDir: options.accountConfigDir,
      }),
  },
  {
    providerId: "copilot",
    create: (options) => new CopilotQuotaProvider({ logger: options.logger, fetch: options.fetch }),
  },
  {
    providerId: "cursor",
    create: (options) => new CursorQuotaProvider({ logger: options.logger, fetch: options.fetch }),
  },
  {
    providerId: "zai",
    create: (options) => new ZaiQuotaProvider({ logger: options.logger, fetch: options.fetch }),
  },
  {
    providerId: "grok",
    create: (options) => new GrokQuotaProvider({ logger: options.logger, fetch: options.fetch }),
  },
  {
    providerId: "kimi",
    create: (options) => new KimiQuotaProvider({ logger: options.logger, fetch: options.fetch }),
  },
  {
    providerId: "minimax",
    create: (options) => new MiniMaxQuotaProvider({ logger: options.logger, fetch: options.fetch }),
  },
];

export function createProviderUsageFetchers(
  options: ProviderUsageFetcherFactoryOptions,
): ProviderUsageFetcher[] {
  return PROVIDER_USAGE_FETCHERS.map((entry) => entry.create(options));
}

/**
 * Accounts get their own usage row. Providers with no usage fetcher simply
 * report nothing, same as they do without accounts.
 */
export function createProviderUsageAccountFetchers(
  profiles: readonly ProviderAccountProfile[],
  options: ProviderUsageFetcherFactoryOptions,
): ProviderUsageFetcher[] {
  return profiles.flatMap((profile) => {
    const entry = PROVIDER_USAGE_FETCHERS.find(
      (candidate) => candidate.providerId === profile.baseProviderId,
    );
    if (!entry) {
      return [];
    }
    return [
      withProviderUsageIdentity(
        entry.create({ ...options, accountConfigDir: profile.configDir }),
        profile,
      ),
    ];
  });
}

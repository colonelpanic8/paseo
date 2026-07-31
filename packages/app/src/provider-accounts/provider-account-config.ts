import type { AgentProviderAccounts, ProviderSnapshotEntry } from "@getpaseo/protocol/agent-types";
import type { MutableDaemonConfig, MutableDaemonConfigPatch } from "@getpaseo/protocol/messages";

/**
 * A provider that told us it can be registered more than once. Nothing here
 * knows which providers those are — the daemon reports `accounts` on the
 * snapshot entry, and a provider that doesn't report it simply never offers
 * accounts in the UI.
 */
export interface ProviderAccountBase {
  providerId: string;
  label: string;
  accounts: AgentProviderAccounts;
}

export interface ProviderAccountDraft {
  name: string;
  configDir: string;
}

export interface ProviderAccountConfigPatch {
  providerId: string;
  patch: MutableDaemonConfigPatch;
}

export function listProviderAccountBases(
  entries: ProviderSnapshotEntry[] | undefined,
): ProviderAccountBase[] {
  return (entries ?? []).flatMap((entry) =>
    entry.accounts
      ? [
          {
            providerId: entry.provider,
            label: entry.label ?? entry.provider,
            accounts: entry.accounts,
          },
        ]
      : [],
  );
}

function slugifyAccountName(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function nextProviderId(
  base: ProviderAccountBase,
  name: string,
  existingProviderIds: ReadonlySet<string>,
): string {
  const slug = slugifyAccountName(name) || "account";
  const candidate = `${base.providerId}-${slug}`;
  if (!existingProviderIds.has(candidate)) {
    return candidate;
  }

  let suffix = 2;
  while (existingProviderIds.has(`${candidate}-${suffix}`)) {
    suffix += 1;
  }
  return `${candidate}-${suffix}`;
}

export function isAbsoluteHostPath(value: string): boolean {
  return (
    value.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(value) || /^\\\\[^\\]+\\[^\\]+/.test(value)
  );
}

/**
 * Directories already claimed by an account of this provider, so the form can
 * reject pointing two accounts at the same credentials.
 */
export function listProviderAccountConfigDirs(
  base: ProviderAccountBase,
  config: MutableDaemonConfig | null,
): ReadonlySet<string> {
  const directories = new Set<string>();
  for (const provider of Object.values(config?.providers ?? {})) {
    if (
      provider.extends === base.providerId &&
      typeof provider.accountConfigDir === "string" &&
      provider.accountConfigDir.trim()
    ) {
      directories.add(provider.accountConfigDir.trim());
    }
  }
  return directories;
}

/**
 * An account is an ordinary derived provider: it extends its base and points
 * the base's account env var somewhere else. There is no account-shaped config.
 */
export function buildProviderAccountConfigPatch(
  base: ProviderAccountBase,
  draft: ProviderAccountDraft,
  existingProviderIds: ReadonlySet<string>,
): ProviderAccountConfigPatch {
  const name = draft.name.trim();
  const providerId = nextProviderId(base, name, existingProviderIds);

  return {
    providerId,
    patch: {
      providers: {
        [providerId]: {
          extends: base.providerId,
          label: `${base.label} · ${name}`,
          env: {
            [base.accounts.envVar]: draft.configDir.trim(),
          },
          enabled: true,
        },
      },
    },
  };
}

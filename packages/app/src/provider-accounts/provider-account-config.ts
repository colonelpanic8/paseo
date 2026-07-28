import type { MutableDaemonConfig, MutableDaemonConfigPatch } from "@getpaseo/protocol/messages";

export type AccountProvider = "claude" | "codex";

interface AccountProviderSpec {
  providerPrefix: string;
  label: string;
  description: string;
  directoryEnvKey: "CLAUDE_CONFIG_DIR" | "CODEX_HOME";
}

const ACCOUNT_PROVIDER_SPECS: Record<AccountProvider, AccountProviderSpec> = {
  claude: {
    providerPrefix: "claude-account-",
    label: "Claude",
    description: "Claude Code account with a separate configuration directory",
    directoryEnvKey: "CLAUDE_CONFIG_DIR",
  },
  codex: {
    providerPrefix: "codex-account-",
    label: "Codex",
    description: "Codex account with separate ChatGPT or OpenAI credentials",
    directoryEnvKey: "CODEX_HOME",
  },
};

export interface ProviderAccountDraft {
  name: string;
  configDir: string;
}

export interface ProviderAccountConfigPatch {
  providerId: string;
  patch: MutableDaemonConfigPatch;
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
  provider: AccountProvider,
  name: string,
  existingProviderIds: ReadonlySet<string>,
): string {
  const spec = ACCOUNT_PROVIDER_SPECS[provider];
  const slug = slugifyAccountName(name) || "account";
  const base = `${spec.providerPrefix}${slug}`;
  if (!existingProviderIds.has(base)) {
    return base;
  }

  let suffix = 2;
  while (existingProviderIds.has(`${base}-${suffix}`)) {
    suffix += 1;
  }
  return `${base}-${suffix}`;
}

export function isAbsoluteHostPath(value: string): boolean {
  return (
    value.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(value) || /^\\\\[^\\]+\\[^\\]+/.test(value)
  );
}

export function listProviderAccountConfigDirs(
  accountProvider: AccountProvider,
  config: MutableDaemonConfig | null,
): ReadonlySet<string> {
  const directories = new Set<string>();
  for (const provider of Object.values(config?.providers ?? {})) {
    if (
      provider.extends === accountProvider &&
      typeof provider.accountConfigDir === "string" &&
      provider.accountConfigDir.trim()
    ) {
      directories.add(provider.accountConfigDir.trim());
    }
  }
  return directories;
}

export function buildProviderAccountConfigPatch(
  accountProvider: AccountProvider,
  draft: ProviderAccountDraft,
  config: MutableDaemonConfig | null,
): ProviderAccountConfigPatch {
  const spec = ACCOUNT_PROVIDER_SPECS[accountProvider];
  const name = draft.name.trim();
  const configDir = draft.configDir.trim();
  const providerId = nextProviderId(
    accountProvider,
    name,
    new Set(Object.keys(config?.providers ?? {})),
  );

  return {
    providerId,
    patch: {
      providers: {
        [providerId]: {
          extends: accountProvider,
          label: `${spec.label} · ${name}`,
          description: spec.description,
          env: {
            [spec.directoryEnvKey]: configDir,
          },
          enabled: true,
        },
      },
    },
  };
}

import { promises as fs } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { ProviderOverrideSchema } from "@getpaseo/protocol/provider-config";
import { expandTilde } from "../../utils/path.js";
import type { UsageProvider } from "./transcripts.js";

const USAGE_PROVIDERS: readonly UsageProvider[] = ["claude", "codex", "opencode"];

const HOME_ENV_VAR: Record<Exclude<UsageProvider, "opencode">, string> = {
  claude: "CLAUDE_CONFIG_DIR",
  codex: "CODEX_HOME",
};
/**
 * OpenCode resolves its data directory from `XDG_DATA_HOME` rather than a dedicated variable, so
 * a configured value names the base data dir and `opencode` is appended below.
 */
const OPENCODE_BASE_ENV_VAR = "XDG_DATA_HOME";
const DEFAULT_HOME_BASENAME: Record<Exclude<UsageProvider, "opencode">, string> = {
  claude: ".claude",
  codex: ".codex",
};
const TRANSCRIPT_SUBDIR: Record<UsageProvider, string> = {
  claude: "projects",
  codex: "sessions",
  // OpenCode's SQLite databases live directly in the data directory.
  opencode: "",
};
/** One provider-owned transcript directory to scan. */
export interface TranscriptHome {
  /** Base kind the configured provider resolves to. */
  readonly provider: UsageProvider;
  /** Configured provider id owning the home, e.g. `codex-colonel`. */
  readonly providerId: string;
  /** Configured display label. Absent on a built-in, which the client already names. */
  readonly label?: string;
  /** The provider home, e.g. `~/.codex-colonelpanic8`. */
  readonly home: string;
  /** The transcript directory inside that home. */
  readonly dir: string;
}

export interface ResolveTranscriptHomesInput {
  /** Raw `agents.providers` overrides; entries that do not parse are ignored. */
  readonly overrides?: Readonly<Record<string, unknown>> | undefined;
  /** Home used by a provider that sets no home environment variable of its own. */
  readonly defaultHomes?: Partial<Record<UsageProvider, string>> | undefined;
}

interface NormalizedOverride {
  readonly extends?: string;
  readonly label?: string;
  readonly env?: Readonly<Record<string, string>>;
}

function normalizeOverrides(
  overrides: Readonly<Record<string, unknown>> | undefined,
): Map<string, NormalizedOverride> {
  const normalized = new Map<string, NormalizedOverride>();
  for (const [providerId, value] of Object.entries(overrides ?? {})) {
    const parsed = ProviderOverrideSchema.safeParse(value);
    if (parsed.success) normalized.set(providerId, parsed.data);
  }
  return normalized;
}

function isUsageProvider(value: string): value is UsageProvider {
  return (USAGE_PROVIDERS as readonly string[]).includes(value);
}

/**
 * Follows `extends` until a transcript-keeping built-in is reached. Providers that land anywhere
 * else — copilot, pi, omp, acp — record no token usage, and a cycle resolves to nothing.
 */
export function resolveUsageProviderKind(
  providerId: string,
  overrides: Readonly<Record<string, unknown>> | undefined,
): UsageProvider | null {
  return resolveKind(providerId, normalizeOverrides(overrides));
}

function resolveKind(
  providerId: string,
  overrides: Map<string, NormalizedOverride>,
): UsageProvider | null {
  const visited = new Set<string>();
  let current = providerId;
  while (!visited.has(current)) {
    if (isUsageProvider(current)) return current;
    visited.add(current);
    const parent = overrides.get(current)?.extends;
    if (parent === undefined) return null;
    current = parent;
  }
  return null;
}

function defaultHome(provider: Exclude<UsageProvider, "opencode">): string {
  return (
    process.env[HOME_ENV_VAR[provider]] ?? path.join(homedir(), DEFAULT_HOME_BASENAME[provider])
  );
}

/** OpenCode's data directory follows `XDG_DATA_HOME`, defaulting to `~/.local/share/opencode`. */
export function defaultOpenCodeDataDir(): string {
  const base = process.env[OPENCODE_BASE_ENV_VAR]?.trim();
  return path.join(
    base !== undefined && base.length > 0
      ? expandTilde(base)
      : path.join(homedir(), ".local", "share"),
    "opencode",
  );
}

function resolveHomeDir(
  provider: UsageProvider,
  override: NormalizedOverride | undefined,
  defaultHomes: Partial<Record<UsageProvider, string>> | undefined,
): string {
  if (provider === "opencode") {
    const configuredBase = override?.env?.[OPENCODE_BASE_ENV_VAR]?.trim();
    if (configuredBase !== undefined && configuredBase.length > 0) {
      return path.resolve(path.join(expandTilde(configuredBase), "opencode"));
    }
    const fallback = defaultHomes?.[provider] ?? defaultOpenCodeDataDir();
    return path.resolve(expandTilde(fallback));
  }
  const configuredHome = override?.env?.[HOME_ENV_VAR[provider]]?.trim();
  return path.resolve(
    expandTilde(
      configuredHome !== undefined && configuredHome.length > 0
        ? configuredHome
        : (defaultHomes?.[provider] ?? defaultHome(provider)),
    ),
  );
}

/**
 * One home per configured provider, built-in defaults first so a shared directory always keeps the
 * same winner after deduplication.
 */
export function resolveTranscriptHomes(
  input: ResolveTranscriptHomesInput = {},
): readonly TranscriptHome[] {
  const overrides = normalizeOverrides(input.overrides);
  const homes: TranscriptHome[] = [];
  const claimed = new Set<string>();

  const add = (providerId: string, provider: UsageProvider): void => {
    if (claimed.has(providerId)) return;
    claimed.add(providerId);
    const override = overrides.get(providerId);
    const home = resolveHomeDir(provider, override, input.defaultHomes);
    homes.push({
      provider,
      providerId,
      label: override?.label,
      home,
      dir: path.join(home, TRANSCRIPT_SUBDIR[provider]),
    });
  };

  // Past usage under a default home is still real, so it is scanned even when disabled.
  for (const provider of USAGE_PROVIDERS) add(provider, provider);
  for (const providerId of overrides.keys()) {
    const provider = resolveKind(providerId, overrides);
    if (provider !== null) add(providerId, provider);
  }
  return homes;
}

/**
 * Two configured providers may point at one directory, directly or through a symlink. Scanning it
 * twice would double count every token in it, so only the first home in order survives.
 */
export async function dedupeTranscriptHomes(
  homes: readonly TranscriptHome[],
): Promise<readonly TranscriptHome[]> {
  const kept: TranscriptHome[] = [];
  const seen = new Set<string>();
  for (const home of homes) {
    const identity = await transcriptDirIdentity(home.dir);
    if (seen.has(identity)) continue;
    seen.add(identity);
    kept.push(home);
  }
  return kept;
}

/** A transcript directory the provider has not created yet still resolves through its home. */
async function transcriptDirIdentity(dir: string): Promise<string> {
  try {
    return await fs.realpath(dir);
  } catch {
    // Fall through to resolving the parent.
  }
  try {
    return path.join(await fs.realpath(path.dirname(dir)), path.basename(dir));
  } catch {
    return dir;
  }
}

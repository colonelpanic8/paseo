import { access, readFile, realpath } from "node:fs/promises";
import { PluginRegistriesSchema } from "@getpaseo/protocol/plugin-registry";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";

import {
  AgentProviderRuntimeSettingsMapSchema,
  migrateProviderSettings,
  ProviderOverridesSchema,
} from "./agent/provider-launch-config.js";
import type { AgentProviderRuntimeSettingsMap } from "./agent/provider-launch-config.js";
import { persistPaseoLayoutSelection, resolvePaseoPaths, type PaseoPaths } from "./paseo-paths.js";
import {
  ensurePrivateFile,
  ensurePrivateFileAsync,
  writePrivateFileAtomic,
  writePrivateFileAtomicSync,
} from "./private-files.js";
import { AgentProfileSchema, AgentSkillSelectionSchema } from "@getpaseo/protocol/agent-profile";
import { PluginIdSchema, PluginSourceSchema } from "@getpaseo/protocol/plugin-config";
import { TerminalProfileSchema } from "@getpaseo/protocol/terminal-profile";
import { PaseoServicePortAllocationSchema } from "@getpaseo/protocol/paseo-config-schema";

export const LogLevelSchema = z.enum(["trace", "debug", "info", "warn", "error", "fatal"]);
export const LogFormatSchema = z.enum(["pretty", "json"]);

const LogConfigSchema = z
  .object({
    // Legacy global log settings (kept for backwards compatibility).
    level: LogLevelSchema.optional(),
    format: LogFormatSchema.optional(),

    console: z
      .object({
        level: LogLevelSchema.optional(),
        format: LogFormatSchema.optional(),
      })
      .strict()
      .optional(),

    file: z
      .object({
        level: LogLevelSchema.optional(),
        path: z.string().min(1).optional(),
        rotate: z
          .object({
            maxSize: z.string().min(1).optional(),
            maxFiles: z.number().int().positive().optional(),
          })
          .strict()
          .optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

const LocalSpeechProviderSchema = z
  .object({
    modelsDir: z.string().min(1).optional(),
  })
  .strict();

const ProvidersSchema = z
  .object({
    local: LocalSpeechProviderSchema.optional(),
  })
  .strict();

const WorktreesConfigSchema = z
  .object({
    root: z.string().min(1).optional(),
    servicePorts: PaseoServicePortAllocationSchema.optional(),
  })
  .strict();

const BcryptHashSchema = z.string().regex(/^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/, {
  message: "Expected a bcrypt hash",
});

const DaemonAuthSchema = z
  .object({
    password: BcryptHashSchema.optional(),
  })
  .strict();

const SpeechProviderIdSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.enum(["openai", "local"]));

const SpeechModelSchema = z.string().min(1).optional();
const OpenAiConnectionFields = {
  apiKey: z.string().trim().min(1).optional(),
  baseUrl: z.string().trim().min(1).optional(),
};

export const SpeechSttConfigSchema = z.discriminatedUnion("provider", [
  z
    .object({
      provider: z.literal("local"),
      model: SpeechModelSchema,
      language: z.string().trim().min(1).optional(),
    })
    .strict(),
  z
    .object({
      provider: z.literal("openai"),
      ...OpenAiConnectionFields,
      model: SpeechModelSchema,
      language: z.string().trim().min(1).optional(),
      confidenceThreshold: z.number().optional(),
    })
    .strict(),
]);

export const SpeechTtsConfigSchema = z.discriminatedUnion("provider", [
  z
    .object({
      provider: z.literal("local"),
      model: SpeechModelSchema,
      speakerId: z.number().int().optional(),
      speed: z.number().optional(),
    })
    .strict(),
  z
    .object({
      provider: z.literal("openai"),
      ...OpenAiConnectionFields,
      model: SpeechModelSchema,
      voice: z.string().trim().min(1).optional(),
    })
    .strict(),
]);

const FeatureDictationSchema = z
  .object({
    enabled: z.boolean().optional(),
    stt: SpeechSttConfigSchema.optional(),
  })
  .strict();

const FeatureVoiceModeSchema = z
  .object({
    enabled: z.boolean().optional(),
    llm: z
      .object({
        provider: z.string().optional(),
        model: z.string().min(1).optional(),
      })
      .strict()
      .optional(),
    stt: SpeechSttConfigSchema.optional(),
    turnDetection: z
      .object({
        provider: SpeechProviderIdSchema.optional(),
      })
      .strict()
      .optional(),
    tts: SpeechTtsConfigSchema.optional(),
  })
  .strict();

const FeatureWebUiSchema = z
  .object({
    enabled: z.boolean().optional(),
    distDir: z.string().min(1).optional(),
  })
  .strict();

const StructuredGenerationProviderConfigSchema = z
  .object({
    provider: z.string().min(1),
    model: z.string().min(1).optional(),
    thinkingOptionId: z.string().min(1).optional(),
  })
  .strict();

const AgentMetadataGenerationSchema = z
  .object({
    providers: z.array(StructuredGenerationProviderConfigSchema).optional(),
  })
  .strict();

const BUILTIN_PROVIDER_IDS = ["claude", "codex", "copilot", "opencode", "pi", "omp"] as const;

function isLegacyProviderEntry(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const command = (value as Record<string, unknown>).command;
  if (!command || typeof command !== "object" || Array.isArray(command)) {
    return false;
  }

  return typeof (command as Record<string, unknown>).mode === "string";
}

function normalizeAgentProviders(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return value;
  }

  const rawProviders = value as Record<string, unknown>;
  const hasLegacyEntries = Object.values(rawProviders).some((entry) =>
    isLegacyProviderEntry(entry),
  );
  if (!hasLegacyEntries) {
    return value;
  }

  const legacyEntries: Record<string, unknown> = {};
  const normalizedEntries: Record<string, unknown> = {};

  for (const [providerId, providerValue] of Object.entries(rawProviders)) {
    if (isLegacyProviderEntry(providerValue)) {
      legacyEntries[providerId] = providerValue;
      continue;
    }
    normalizedEntries[providerId] = providerValue;
  }

  const parsedLegacyEntries = AgentProviderRuntimeSettingsMapSchema.safeParse(legacyEntries);
  if (!parsedLegacyEntries.success) {
    return value;
  }

  return {
    ...normalizedEntries,
    ...migrateProviderSettings(parsedLegacyEntries.data, [...BUILTIN_PROVIDER_IDS]),
  };
}

export const PersistedConfigSchema = z
  .object({
    $schema: z.string().optional(),

    // v1 schema marker
    version: z.literal(1).optional(),

    imports: z.array(z.string().min(1)).optional(),
    writeTo: z.string().min(1).optional(),

    // v1 config layout
    daemon: z
      .object({
        listen: z.string().optional(),
        hostnames: z.union([z.literal(true), z.array(z.string())]).optional(),
        allowedHosts: z.union([z.literal(true), z.array(z.string())]).optional(),
        trustedProxies: z
          .union([z.literal(true), z.array(z.string())])
          .optional()
          .describe(
            'Express trusted proxy setting for X-Forwarded-* headers. Defaults to ["loopback"]. Use true only when the final trusted proxy overwrites client-supplied forwarded headers.',
          ),
        mcp: z
          .object({
            enabled: z.boolean().optional(),
            injectIntoAgents: z.boolean().optional(),
          })
          .passthrough()
          .optional(),
        usage: z.object({ enabled: z.boolean().optional() }).optional(),
        browserTools: z
          .object({
            enabled: z.boolean().optional(),
          })
          .passthrough()
          .optional(),
        git: z
          .object({
            maxProcessesPerSecond: z.number().int().positive().optional(),
            maxProcessConcurrency: z.number().int().positive().optional(),
          })
          .strict()
          .optional(),
        autoArchiveAfterMerge: z.boolean().optional(),
        enableTerminalAgentHooks: z.boolean().optional(),
        appendSystemPrompt: z.string().optional(),
        terminalProfiles: z.array(TerminalProfileSchema).optional(),
        agentProfiles: z.array(AgentProfileSchema).optional(),
        cors: z
          .object({
            allowedOrigins: z.array(z.string()).optional(),
          })
          .strict()
          .optional(),
        relay: z
          .object({
            enabled: z.boolean().optional(),
            requireProtectedSecurity: z
              .boolean()
              .optional()
              .describe(
                "Admit only relay clients that negotiate protected endpoint security (replay protection). Defaults to false; older clients still connect while it is off.",
              ),
            endpoint: z.string().optional(),
            publicEndpoint: z.string().optional(),
            useTls: z.boolean().optional(),
            publicUseTls: z.boolean().optional(),
          })
          .strict()
          .optional(),
        serviceProxy: z
          .object({
            // COMPAT(serviceProxyEnabled): added 2026-06-02, remove after 2026-12-02.
            // Parsed only to suppress optional public/listen layers for old configs;
            // localhost service proxying remains always enabled.
            enabled: z
              .boolean()
              .optional()
              .describe(
                "Compatibility shim. false suppresses optional service proxy listen/public layers only; localhost proxying remains enabled.",
              ),
            listen: z
              .string()
              .optional()
              .describe(
                "Optional service-only listener address. Presence enables the standalone service proxy listener.",
              ),
            publicBaseUrl: z
              .url()
              .optional()
              .describe("Optional public base URL for service host aliases."),
          })
          .strict()
          .optional(),
        auth: DaemonAuthSchema.optional(),
      })
      .strict()
      .transform(({ allowedHosts, ...daemon }) => {
        const hostnames = daemon.hostnames ?? allowedHosts;
        return hostnames === undefined ? daemon : { ...daemon, hostnames };
      })
      .optional(),

    app: z
      .object({
        baseUrl: z.string().optional(),
      })
      .strict()
      .optional(),

    providers: ProvidersSchema.optional(),
    pluginRegistries: PluginRegistriesSchema.optional(),
    pluginsEnabled: z.boolean().optional(),
    plugins: z.record(PluginIdSchema, PluginSourceSchema).optional(),
    worktrees: WorktreesConfigSchema.optional(),
    agents: z
      .object({
        providers: z.preprocess(normalizeAgentProviders, ProviderOverridesSchema).optional(),
        idleRuntimeCleanup: z.boolean().optional(),
        resumeOnStartup: z.boolean().optional(),
        resumePrompt: z.string().optional(),
        catalogRefreshTimeoutMs: z.number().int().positive().max(2_147_483_647).optional(),
        metadataGeneration: AgentMetadataGenerationSchema.optional(),
        skills: z.object({ selection: AgentSkillSelectionSchema.optional() }).strict().optional(),
      })
      .strict()
      .optional(),
    features: z
      .object({
        dictation: FeatureDictationSchema.optional(),
        voiceMode: FeatureVoiceModeSchema.optional(),
        webUi: FeatureWebUiSchema.optional(),
      })
      .strict()
      .optional(),

    log: LogConfigSchema.optional(),
  })
  .strict();

type PersistedConfigSchemaOutput = z.infer<typeof PersistedConfigSchema>;

export type PersistedConfig = Omit<PersistedConfigSchemaOutput, "agents"> & {
  agents?: Omit<NonNullable<PersistedConfigSchemaOutput["agents"]>, "providers"> & {
    providers?: AgentProviderRuntimeSettingsMap;
  };
};

export interface ConfigStructuralKeys {
  $schema?: string;
  version?: 1;
  imports?: string[];
  writeTo?: string;
}

export interface ConfigLayer {
  path: string;
  body: PersistedConfig;
  structural: ConfigStructuralKeys;
  raw: string;
}

export interface ConfigStack {
  rootPath: string;
  layers: ConfigLayer[];
  writeTargetPath: string;
  /** The write target as referenced, so saving a symlinked file keeps the link. */
  writeFilePath: string;
  effective: PersistedConfig;
}

const CONFIG_FILENAME = "config.json";
const DEFAULT_PERSISTED_CONFIG = PersistedConfigSchema.parse({
  version: 1,
  daemon: {
    listen: "127.0.0.1:6767",
    cors: {
      allowedOrigins: ["https://app.paseo.sh"],
    },
    relay: {
      enabled: false,
    },
  },
  app: {
    baseUrl: "https://app.paseo.sh",
  },
}) as PersistedConfig;

interface LoggerLike {
  child(bindings: Record<string, unknown>): LoggerLike;
  info(...args: unknown[]): void;
  warn?(...args: unknown[]): void;
}

/**
 * `config.json` belongs to the config category, which under the XDG layout is a different
 * directory from the one the daemon writes state into.
 *
 * Only the canonical home is redirected. A caller that passes some other directory — a test, a
 * tool inspecting a specific home — keeps reading and writing inside the directory it named,
 * which is also exactly what happens under the flat layout, where the two roots are equal.
 */
function resolveConfigRoot(paseoHome: string, paths: PaseoPaths): string {
  return paths.home === path.resolve(paseoHome) ? paths.config : paseoHome;
}

export function resolvePersistedConfigPath(
  paseoHome: string,
  paths: PaseoPaths = resolvePaseoPaths(),
): string {
  return path.resolve(resolveConfigRoot(paseoHome, paths), CONFIG_FILENAME);
}

function getLogger(logger: LoggerLike | undefined): LoggerLike | undefined {
  return logger?.child({ module: "config" });
}

export function deepMerge<T extends Record<string, unknown>>(
  current: T,
  patch: Record<string, unknown>,
): T {
  const next: Record<string, unknown> = { ...current };

  for (const [key, patchValue] of Object.entries(patch)) {
    if (patchValue === undefined) continue;
    const currentValue = next[key];
    if (isConfigRecord(currentValue) && isConfigRecord(patchValue)) {
      next[key] = deepMerge(currentValue, patchValue);
      continue;
    }
    next[key] = patchValue;
  }

  return next as T;
}

function isConfigRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function configRecord(value: unknown): Record<string, unknown> | undefined {
  return isConfigRecord(value) ? value : undefined;
}

// COMPAT(speechProviderConfig): added in v0.12.0, remove after 2027-04-26.
// Fold shared credentials once at the file boundary; consumers see only the strict
// per-site shape. Never include credential values in diagnostics.
function normalizeSpeechProviderConfig(parsed: unknown, logger?: LoggerLike): unknown {
  if (!isConfigRecord(parsed)) return parsed;
  const root = structuredClone(parsed);
  const providers = configRecord(root.providers);
  const legacy = configRecord(providers?.openai);
  const features = configRecord(root.features);
  const foldedKeys = new Set<string>();
  for (const [feature, kind] of [
    ["dictation", "stt"],
    ["voiceMode", "stt"],
    ["voiceMode", "tts"],
  ] as const) {
    const site = configRecord(configRecord(features?.[feature])?.[kind]);
    if (site) normalizeSpeechSite(site, kind, legacy, foldedKeys);
  }
  if (legacy) warnDiscardedSpeechKeys(legacy, foldedKeys, logger);
  if (providers) {
    delete providers.openai;
    const local = configRecord(providers.local);
    if (local) delete local.autoDownload;
  }
  return root;
}

function normalizeSpeechSite(
  site: Record<string, unknown>,
  kind: "stt" | "tts",
  legacy: Record<string, unknown> | undefined,
  foldedKeys: Set<string>,
) {
  site.provider =
    typeof site.provider === "string"
      ? site.provider.trim().toLowerCase()
      : (site.provider ?? "local");
  if (kind === "stt" && site.provider === "local") {
    delete site.confidenceThreshold;
  }
  if (kind === "tts") {
    if (site.provider === "local") delete site.voice;
    if (site.provider === "openai") {
      delete site.speakerId;
      delete site.speed;
    }
  }
  if (site.provider !== "openai" || !legacy) return;
  const endpoint = configRecord(legacy[kind]);
  for (const field of ["apiKey", "baseUrl"] as const) {
    if (site[field] !== undefined) continue;
    if (endpoint?.[field] !== undefined) {
      site[field] = endpoint[field];
      foldedKeys.add(`providers.openai.${kind}.${field}`);
    } else if (legacy[field] !== undefined) {
      site[field] = legacy[field];
      foldedKeys.add(`providers.openai.${field}`);
    }
  }
}

function warnDiscardedSpeechKeys(
  legacy: Record<string, unknown>,
  foldedKeys: Set<string>,
  logger?: LoggerLike,
) {
  const keys = [
    ["providers.openai.apiKey", legacy.apiKey],
    ...["stt", "tts"].map((kind) => [
      `providers.openai.${kind}.apiKey`,
      configRecord(legacy[kind])?.apiKey,
    ]),
  ] as const;
  for (const [keyPath, key] of keys) {
    if (key && typeof keyPath === "string" && !foldedKeys.has(keyPath)) {
      const message = `Dropped ${keyPath}: no use site in config.json selects OpenAI; re-enter it when selecting OpenAI.`;
      if (logger?.warn) logger.warn(message);
      else console.warn(message);
    }
  }
}

function formatValidationIssues(error: z.ZodError): string {
  return error.issues.map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`).join("\n");
}

function splitConfig(config: PersistedConfigSchemaOutput): {
  structural: ConfigStructuralKeys;
  body: PersistedConfig;
} {
  const { $schema, version, imports, writeTo, ...body } = config;
  const structural: ConfigStructuralKeys = {};
  if ($schema !== undefined) structural.$schema = $schema;
  if (version !== undefined) structural.version = version;
  if (imports !== undefined) structural.imports = imports;
  if (writeTo !== undefined) structural.writeTo = writeTo;
  const jsonBody = JSON.parse(JSON.stringify(body)) as PersistedConfig;
  return { structural, body: jsonBody };
}

function parseConfigFile(
  raw: string,
  configPath: string,
  logger?: LoggerLike,
): Omit<ConfigLayer, "path" | "raw"> {
  let parsed: unknown;
  try {
    parsed = parseConfigText(raw);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`[Config] Invalid JSON in ${configPath}: ${message}`, { cause: err });
  }

  const result = PersistedConfigSchema.safeParse(normalizeSpeechProviderConfig(parsed, logger));
  if (!result.success) {
    throw new Error(
      `[Config] Invalid config in ${configPath}:\n${formatValidationIssues(result.error)}`,
    );
  }
  return splitConfig(result.data);
}

function resolveConfigReference(configPath: string, reference: string): string {
  const expanded = reference.startsWith("~/")
    ? path.join(homedir(), reference.slice(2))
    : reference;
  return path.resolve(path.dirname(configPath), expanded);
}

type ConfigIoRequest =
  | { kind: "exists"; path: string }
  | { kind: "realpath"; path: string }
  | { kind: "read"; path: string; ensurePrivate: boolean }
  | { kind: "write"; path: string; data: string };

/** Config file IO as data, so one implementation serves startup (sync) and runtime (async) callers. */
type ConfigIo<T> = Generator<ConfigIoRequest, T, unknown>;

function* configFileExists(filePath: string): ConfigIo<boolean> {
  return (yield { kind: "exists", path: filePath }) as boolean;
}

function* resolveConfigRealpath(filePath: string): ConfigIo<string> {
  return (yield { kind: "realpath", path: filePath }) as string;
}

function* readConfigFile(filePath: string, ensurePrivate: boolean): ConfigIo<string> {
  return (yield { kind: "read", path: filePath, ensurePrivate }) as string;
}

function* writeConfigText(filePath: string, data: string): ConfigIo<void> {
  yield { kind: "write", path: filePath, data };
}

function performConfigIoSync(request: ConfigIoRequest): unknown {
  switch (request.kind) {
    case "exists":
      return existsSync(request.path);
    case "realpath":
      return realpathSync(request.path);
    case "read":
      if (request.ensurePrivate) ensurePrivateFile(request.path);
      return readFileSync(request.path, "utf-8");
    case "write":
      return writePrivateFileAtomicSync(request.path, request.data);
  }
}

async function performConfigIo(request: ConfigIoRequest): Promise<unknown> {
  switch (request.kind) {
    case "exists":
      return access(request.path).then(
        () => true,
        () => false,
      );
    case "realpath":
      return realpath(request.path);
    case "read":
      if (request.ensurePrivate) await ensurePrivateFileAsync(request.path);
      return readFile(request.path, "utf-8");
    case "write":
      return writePrivateFileAtomic(request.path, request.data);
  }
}

function runConfigIoSync<T>(io: ConfigIo<T>): T {
  let step = io.next();
  while (!step.done) {
    let result: unknown;
    try {
      result = performConfigIoSync(step.value);
    } catch (error) {
      step = io.throw(error);
      continue;
    }
    step = io.next(result);
  }
  return step.value;
}

async function runConfigIo<T>(io: ConfigIo<T>): Promise<T> {
  let step = io.next();
  while (!step.done) {
    let result: unknown;
    try {
      result = await performConfigIo(step.value);
    } catch (error) {
      step = io.throw(error);
      continue;
    }
    step = io.next(result);
  }
  return step.value;
}

interface LoadLayerParams {
  requestedPath: string;
  importingPath?: string;
  ancestry: string[];
  loadedByPath: Map<string, ConfigLayer>;
  isRoot: boolean;
  logger?: LoggerLike;
  ensureRootPrivate: boolean;
}

function* loadLayer(
  params: LoadLayerParams,
): ConfigIo<{ layer: ConfigLayer; layers: ConfigLayer[] }> {
  const requestedPath = path.resolve(params.requestedPath);
  if (!(yield* configFileExists(requestedPath))) {
    if (params.importingPath) {
      throw new Error(
        `[Config] Import ${requestedPath} referenced by ${params.importingPath} does not exist`,
      );
    }
    throw new Error(`[Config] Failed to read ${requestedPath}: file does not exist`);
  }
  let configPath: string;
  try {
    configPath = yield* resolveConfigRealpath(requestedPath);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`[Config] Failed to resolve ${requestedPath}: ${message}`, { cause: err });
  }

  const cycleStart = params.ancestry.indexOf(configPath);
  if (cycleStart !== -1) {
    const cycle = [...params.ancestry.slice(cycleStart), configPath].join(" -> ");
    throw new Error(`[Config] Config import cycle: ${cycle}`);
  }

  const loaded = params.loadedByPath.get(configPath);
  if (loaded) {
    return { layer: loaded, layers: [] };
  }

  let raw: string;
  try {
    raw = yield* readConfigFile(configPath, params.isRoot && params.ensureRootPrivate);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`[Config] Failed to read ${configPath}: ${message}`, { cause: err });
  }

  const parsed = parseConfigFile(raw, configPath, params.logger);
  if (!params.isRoot && parsed.structural.writeTo !== undefined) {
    throw new Error(
      `[Config] Invalid config in ${configPath}:\n  - writeTo: writeTo is only allowed in the root config file`,
    );
  }

  const layer: ConfigLayer = { path: configPath, raw, ...parsed };
  params.loadedByPath.set(configPath, layer);
  const ancestry = [...params.ancestry, configPath];
  const layers: ConfigLayer[] = [];
  for (const importedPath of layer.structural.imports ?? []) {
    const imported = yield* loadLayer({
      requestedPath: resolveConfigReference(configPath, importedPath),
      importingPath: configPath,
      ancestry,
      loadedByPath: params.loadedByPath,
      isRoot: false,
      logger: params.logger,
      ensureRootPrivate: params.ensureRootPrivate,
    });
    layers.push(...imported.layers);
  }
  layers.push(layer);
  return { layer, layers };
}

function validateEffectiveConfig(config: PersistedConfig, context: string): PersistedConfig {
  const result = PersistedConfigSchema.safeParse(config);
  if (!result.success) {
    throw new Error(`[Config] Invalid ${context}:\n${formatValidationIssues(result.error)}`);
  }
  return splitConfig(result.data).body;
}

function mergeLayers(layers: readonly ConfigLayer[], writeTarget?: ConfigLayer): PersistedConfig {
  let effective: PersistedConfig = {};
  for (const layer of layers) {
    const body = writeTarget && layer.path === writeTarget.path ? writeTarget.body : layer.body;
    effective = deepMerge(effective, body);
  }
  return effective;
}

function* initializeRootConfig(configPath: string, logger?: LoggerLike): ConfigIo<void> {
  try {
    yield* writeConfigText(configPath, JSON.stringify(DEFAULT_PERSISTED_CONFIG, null, 2) + "\n");
    logger?.info(`Initialized config file at ${configPath}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`[Config] Failed to initialize ${configPath}: ${message}`, { cause: err });
  }
}

function* readConfigStack(
  paseoHome: string,
  logger: LoggerLike | undefined,
  paths: PaseoPaths,
): ConfigIo<ConfigStack> {
  const log = getLogger(logger);
  if (paths.home === path.resolve(paseoHome)) persistPaseoLayoutSelection(paths);
  const requestedRootPath = resolvePersistedConfigPath(paseoHome, paths);
  if (!(yield* configFileExists(requestedRootPath))) {
    yield* initializeRootConfig(requestedRootPath, log);
  }

  return yield* readExistingConfigStack(requestedRootPath, log, true);
}

function* readExistingConfigStack(
  requestedRootPath: string,
  log: LoggerLike | undefined,
  ensureRootPrivate: boolean,
): ConfigIo<ConfigStack> {
  const loaded = yield* loadLayer({
    requestedPath: requestedRootPath,
    ancestry: [],
    loadedByPath: new Map(),
    isRoot: true,
    logger: log,
    ensureRootPrivate,
  });
  const rootPath = loaded.layer.path;
  const effective = validateEffectiveConfig(mergeLayers(loaded.layers), "merged config");

  const writeTo = loaded.layer.structural.writeTo;
  const requestedWriteTarget = writeTo
    ? resolveConfigReference(rootPath, writeTo)
    : requestedRootPath;
  const resolvedWriteTarget = (yield* configFileExists(requestedWriteTarget))
    ? yield* resolveConfigRealpath(requestedWriteTarget)
    : requestedWriteTarget;
  const writeTarget = loaded.layers.find((layer) => layer.path === resolvedWriteTarget);
  if (!writeTarget) {
    throw new Error(
      `[Config] writeTo in ${rootPath} resolves to ${requestedWriteTarget}, which is not the root config or an imported file`,
    );
  }

  log?.info(`Loaded from ${rootPath}`);
  return {
    rootPath,
    layers: loaded.layers,
    writeTargetPath: writeTarget.path,
    writeFilePath: requestedWriteTarget,
    effective,
  };
}

export function loadConfigStack(
  paseoHome: string,
  logger?: LoggerLike,
  paths: PaseoPaths = resolvePaseoPaths(),
): ConfigStack {
  return runConfigIoSync(readConfigStack(paseoHome, logger, paths));
}

export function loadConfigStackAsync(
  paseoHome: string,
  logger?: LoggerLike,
  paths: PaseoPaths = resolvePaseoPaths(),
): Promise<ConfigStack> {
  return runConfigIo(readConfigStack(paseoHome, logger, paths));
}

export function loadPersistedConfig(
  paseoHome: string,
  logger?: LoggerLike,
  paths: PaseoPaths = resolvePaseoPaths(),
): PersistedConfig {
  return loadConfigStack(paseoHome, logger, paths).effective;
}

/** Runtime config IO. Startup and offline CLI consumers retain their synchronous entry points. */
export async function loadPersistedConfigAsync(
  paseoHome: string,
  logger?: LoggerLike,
  paths: PaseoPaths = resolvePaseoPaths(),
): Promise<PersistedConfig> {
  return (await loadConfigStackAsync(paseoHome, logger, paths)).effective;
}

function deepDiff(
  desired: Record<string, unknown>,
  otherLayers: Record<string, unknown>,
): Record<string, unknown> {
  const diff: Record<string, unknown> = {};
  for (const [key, desiredValue] of Object.entries(desired)) {
    const otherValue = otherLayers[key];
    if (isDeepStrictEqual(desiredValue, otherValue)) continue;
    if (isConfigRecord(desiredValue) && isConfigRecord(otherValue)) {
      const nested = deepDiff(desiredValue, otherValue);
      if (Object.keys(nested).length > 0) diff[key] = nested;
      continue;
    }
    diff[key] = desiredValue;
  }
  return diff;
}

function collectDifferentPaths(desired: unknown, actual: unknown, prefix: string[] = []): string[] {
  if (isDeepStrictEqual(desired, actual)) return [];
  if (!isConfigRecord(desired) || !isConfigRecord(actual)) return [prefix.join(".")];

  const paths: string[] = [];
  const keys = new Set([...Object.keys(desired), ...Object.keys(actual)]);
  for (const key of keys) {
    const nextPrefix = [...prefix, key];
    const desiredHasKey = Object.hasOwn(desired, key);
    const actualHasKey = Object.hasOwn(actual, key);
    if (!desiredHasKey || !actualHasKey) {
      paths.push(nextPrefix.join("."));
      continue;
    }
    paths.push(...collectDifferentPaths(desired[key], actual[key], nextPrefix));
  }
  return paths;
}

function definesPath(config: PersistedConfig, fieldPath: string): boolean {
  let current: unknown = config;
  for (const segment of fieldPath.split(".")) {
    if (!isConfigRecord(current) || !Object.hasOwn(current, segment)) return false;
    current = current[segment];
  }
  return true;
}

function findShadowingLayer(stack: ConfigStack, fieldPath: string): ConfigLayer | undefined {
  for (let index = stack.layers.length - 1; index >= 0; index -= 1) {
    const layer = stack.layers[index];
    if (layer.path !== stack.writeTargetPath && definesPath(layer.body, fieldPath)) return layer;
  }
  return undefined;
}

function validateConfigToSave(config: PersistedConfig): PersistedConfigSchemaOutput {
  const result = PersistedConfigSchema.safeParse(config);
  if (!result.success) {
    throw new Error(`[Config] Invalid config to save:\n${formatValidationIssues(result.error)}`);
  }
  return result.data;
}

function* writeConfigFile(
  configPath: string,
  config: PersistedConfigSchemaOutput,
  logger?: LoggerLike,
): ConfigIo<void> {
  try {
    yield* writeConfigText(configPath, JSON.stringify(config, null, 2) + "\n");
    logger?.info(`Saved to ${configPath}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`[Config] Failed to write ${configPath}: ${message}`, { cause: err });
  }
}

function* writeConfigStack(
  stack: ConfigStack,
  config: PersistedConfig,
  logger?: LoggerLike,
): ConfigIo<void> {
  const desired = splitConfig(validateConfigToSave(config)).body;
  const writeTarget = stack.layers.find((layer) => layer.path === stack.writeTargetPath);
  if (!writeTarget) {
    throw new Error(`[Config] Writable config file ${stack.writeTargetPath} is not in the stack`);
  }

  const otherLayers = stack.layers.filter((layer) => layer.path !== stack.writeTargetPath);
  const otherEffective = mergeLayers(otherLayers);
  const candidateBody = deepDiff(desired, otherEffective) as PersistedConfig;
  const candidateConfig = validateConfigToSave({
    ...writeTarget.structural,
    ...candidateBody,
  });
  const candidateLayer: ConfigLayer = {
    ...writeTarget,
    body: splitConfig(candidateConfig).body,
  };
  const simulated = validateEffectiveConfig(
    mergeLayers(stack.layers, candidateLayer),
    "merged config",
  );

  if (!isDeepStrictEqual(simulated, desired)) {
    const fieldPaths = collectDifferentPaths(desired, simulated);
    const issues = fieldPaths.map((fieldPath) => {
      const shadowingLayer = findShadowingLayer(stack, fieldPath);
      if (!shadowingLayer) {
        return `${fieldPath} cannot be represented by the writable config file.`;
      }
      return `${fieldPath} is defined in ${shadowingLayer.path}, which overrides the writable config file. Change it there instead.`;
    });
    throw new Error(`[Config] Cannot save config:\n  - ${issues.join("\n  - ")}`);
  }

  yield* writeConfigFile(stack.writeFilePath, candidateConfig, getLogger(logger));
}

export function saveConfigStack(
  stack: ConfigStack,
  config: PersistedConfig,
  logger?: LoggerLike,
): void {
  runConfigIoSync(writeConfigStack(stack, config, logger));
}

export function saveConfigStackAsync(
  stack: ConfigStack,
  config: PersistedConfig,
  logger?: LoggerLike,
): Promise<void> {
  return runConfigIo(writeConfigStack(stack, config, logger));
}

function* restoreWriteTarget(stack: ConfigStack, logger?: LoggerLike): ConfigIo<void> {
  const writeTarget = stack.layers.find((layer) => layer.path === stack.writeTargetPath);
  if (!writeTarget) {
    throw new Error(`[Config] Writable config file ${stack.writeTargetPath} is not in the stack`);
  }
  try {
    yield* writeConfigText(stack.writeFilePath, writeTarget.raw);
    getLogger(logger)?.info(`Restored ${stack.writeTargetPath}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`[Config] Failed to restore ${stack.writeTargetPath}: ${message}`, {
      cause: err,
    });
  }
}

export function restoreConfigWriteTarget(stack: ConfigStack, logger?: LoggerLike): void {
  runConfigIoSync(restoreWriteTarget(stack, logger));
}

export function restoreConfigWriteTargetAsync(
  stack: ConfigStack,
  logger?: LoggerLike,
): Promise<void> {
  return runConfigIo(restoreWriteTarget(stack, logger));
}

/** Editors such as Windows Notepad save UTF-8 with a byte order mark, which JSON.parse rejects. */
function parseConfigText(raw: string): unknown {
  return JSON.parse(raw.replace(/^\uFEFF/, ""));
}

/** Observe the effective config without initializing a home or default configuration. */
export function readPersistedConfig(
  paseoHome: string,
  options: { defaultsIfMissing?: boolean } = {},
  paths: PaseoPaths = resolvePaseoPaths(),
): PersistedConfig {
  const configPath = resolvePersistedConfigPath(paseoHome, paths);
  if (!existsSync(configPath))
    return options.defaultsIfMissing ? structuredClone(DEFAULT_PERSISTED_CONFIG) : {};
  return runConfigIoSync(readExistingConfigStack(configPath, undefined, false)).effective;
}

function configPathParts(field: string): string[] {
  const parts = field.split(".");
  let schema: z.ZodType = PersistedConfigSchema;
  for (const part of parts) {
    if (!part || ["__proto__", "prototype", "constructor"].includes(part)) {
      throw new Error(`Invalid configuration path: ${field}`);
    }
    while (
      schema instanceof z.ZodOptional ||
      schema instanceof z.ZodDefault ||
      schema instanceof z.ZodPipe
    )
      schema = (schema instanceof z.ZodPipe ? schema.in : schema.unwrap()) as z.ZodType;
    if (schema instanceof z.ZodUnion) {
      const variant = schema.options.find(
        (option) => option instanceof z.ZodObject && Object.hasOwn(option.shape, part),
      );
      if (variant instanceof z.ZodObject) schema = variant;
    }
    if (!(schema instanceof z.ZodObject) || !Object.hasOwn(schema.shape, part)) {
      throw new Error(
        `Unknown configuration path: ${field}. Replace its containing object with JSON for dynamic keys.`,
      );
    }
    schema = schema.shape[part];
  }
  return parts;
}

export function getPersistedConfigValue(config: PersistedConfig, field: string): unknown {
  return configPathParts(field).reduce<unknown>(
    (value, part) =>
      value && typeof value === "object" ? (value as Record<string, unknown>)[part] : undefined,
    config,
  );
}

export function editPersistedConfig(
  paseoHome: string,
  field: string,
  edit: { value: unknown } | { unset: true },
  paths: PaseoPaths = resolvePaseoPaths(),
): PersistedConfig {
  const parts = configPathParts(field);
  if (field === "daemon.auth" || field.startsWith("daemon.auth.")) {
    throw new Error("Use daemon set-password to change the daemon password.");
  }
  const config = structuredClone(
    readPersistedConfig(paseoHome, { defaultsIfMissing: true }, paths),
  );
  let object = config as Record<string, unknown>;
  for (const part of parts.slice(0, -1)) {
    object[part] ??= {};
    object = object[part] as Record<string, unknown>;
  }
  const key = parts.at(-1)!;
  if (field === "daemon") {
    const previousAuth = config.daemon?.auth;
    const nextAuth =
      "value" in edit && edit.value && typeof edit.value === "object"
        ? (edit.value as Record<string, unknown>).auth
        : undefined;
    if (JSON.stringify(previousAuth) !== JSON.stringify(nextAuth))
      throw new Error("Use daemon set-password to change the daemon password.");
  }
  if ("unset" in edit) delete object[key];
  else object[key] = edit.value;
  validateConfigToSave(config);
  const stack = loadConfigStack(paseoHome, undefined, paths);
  saveConfigStack(stack, config);
  return config;
}

function* writePersistedConfig(
  paseoHome: string,
  config: PersistedConfig,
  logger: LoggerLike | undefined,
  paths: PaseoPaths,
): ConfigIo<void> {
  const validated = validateConfigToSave(config);
  const configPath = resolvePersistedConfigPath(paseoHome, paths);
  if (!(yield* configFileExists(configPath))) {
    if (paths.home === path.resolve(paseoHome)) persistPaseoLayoutSelection(paths);
    yield* writeConfigFile(configPath, validated, getLogger(logger));
    return;
  }
  yield* writeConfigStack(yield* readConfigStack(paseoHome, logger, paths), config, logger);
}

export function savePersistedConfig(
  paseoHome: string,
  config: PersistedConfig,
  logger?: LoggerLike,
  paths: PaseoPaths = resolvePaseoPaths(),
): void {
  runConfigIoSync(writePersistedConfig(paseoHome, config, logger, paths));
}

export function savePersistedConfigAsync(
  paseoHome: string,
  config: PersistedConfig,
  logger?: LoggerLike,
  paths: PaseoPaths = resolvePaseoPaths(),
): Promise<void> {
  return runConfigIo(writePersistedConfig(paseoHome, config, logger, paths));
}

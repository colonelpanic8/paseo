import { promises as fs } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import type { Logger } from "pino";
import type {
  MutableDaemonConfig,
  ProviderUsageHistoryPricing,
  ProviderUsageHistoryReadRequestMessage,
  ProviderUsageHistoryReadResponseMessage,
  ProviderUsageHistorySource,
} from "../../server/messages.js";
import { writeFileAtomic } from "../../server/atomic-file.js";
import { expandTilde } from "../../utils/path.js";
import { UsageAggregator } from "./aggregation.js";
import { parseRateTable, type RateTable } from "./pricing.js";
import {
  decodeScanCache,
  dedupeWithinFile,
  encodeScanCache,
  pruneScanCache,
  type CachedFile,
  type ScanCache,
} from "./scan-cache.js";
import { listTranscriptFiles, readTranscriptRecords } from "./transcript-reader.js";
import type { UsageProvider, UsageRecord } from "./transcripts.js";

export const LITELLM_RATES_URL =
  "https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json";
const MAX_WINDOW_DAYS = 90;
const MAX_PENDING_SCANS = 8;
const DAY_MS = 24 * 60 * 60 * 1000;
const RATES_TTL_MS = 24 * 60 * 60 * 1000;
const RATES_REFRESH_FLOOR_MS = 60 * 1000;

/** mtime filtering needs to admit sessions written just before the first local midnight. */
const MTIME_SLACK_MS = 36 * 60 * 60 * 1000;
const CACHE_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;

type UsageHistoryReadInput = Pick<
  ProviderUsageHistoryReadRequestMessage,
  "sinceDay" | "untilDay" | "timeZone"
>;
export type UsageHistorySummary = Omit<
  ProviderUsageHistoryReadResponseMessage["payload"],
  "requestId"
>;

export interface UsageHistoryServiceOptions {
  paseoHome: string;
  logger: Logger;
  claudeConfigDir?: string;
  codexHome?: string;
  getProviderConfigs?: () => MutableDaemonConfig["providers"];
  fetch?: typeof fetch;
  now?: () => number;
}

interface RateSnapshot {
  fetchedAtMs: number;
  document: unknown;
}

interface TranscriptSource {
  provider: UsageProvider;
  dir: string;
}

interface ScannedFile {
  path: string;
  records: readonly UsageRecord[];
}

interface ScannedSource {
  provider: UsageProvider;
  dir: string;
  status: ProviderUsageHistorySource["status"];
  files: readonly ScannedFile[];
  message: string | null;
}

export class UsageHistoryBusyError extends Error {
  constructor() {
    super("Usage history scan queue is full; retry later");
    this.name = "UsageHistoryBusyError";
  }
}

export class UsageHistoryInvalidWindowError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UsageHistoryInvalidWindowError";
  }
}

export function isValidUsageDay(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

export function validateUsageHistoryWindow(input: UsageHistoryReadInput): void {
  if (!isValidUsageDay(input.sinceDay)) {
    throw new UsageHistoryInvalidWindowError(`sinceDay '${input.sinceDay}' is not a valid date`);
  }
  if (!isValidUsageDay(input.untilDay)) {
    throw new UsageHistoryInvalidWindowError(`untilDay '${input.untilDay}' is not a valid date`);
  }
  if (input.sinceDay > input.untilDay) {
    throw new UsageHistoryInvalidWindowError(
      `sinceDay '${input.sinceDay}' is after untilDay '${input.untilDay}'`,
    );
  }
  const days = (Date.parse(input.untilDay) - Date.parse(input.sinceDay)) / DAY_MS + 1;
  if (days > MAX_WINDOW_DAYS) {
    throw new UsageHistoryInvalidWindowError(`window exceeds ${MAX_WINDOW_DAYS} days`);
  }
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: input.timeZone }).resolvedOptions();
  } catch {
    throw new UsageHistoryInvalidWindowError(`timeZone '${input.timeZone}' is not supported`);
  }
}

/** Scans provider-owned transcripts and aggregates API-equivalent usage cost. */
export class UsageHistoryService {
  private readonly logger: Logger;
  private readonly defaultSources: readonly TranscriptSource[];
  private readonly getProviderConfigs: () => MutableDaemonConfig["providers"];
  private scanLock: Promise<void> = Promise.resolve();
  private readonly fetchApi: typeof fetch;
  private readonly now: () => number;
  private readonly scanCachePath: string;
  private readonly ratesCachePath: string;
  private readonly fileCache: ScanCache = new Map();
  private scanCacheLoad: Promise<void> | null = null;
  private cacheDirty = false;
  private rates: RateTable = new Map();
  private ratesFetchedAtMs: number | null = null;
  private ratesStatus: ProviderUsageHistoryPricing["status"] = "unavailable";
  private ratesLock: Promise<void> = Promise.resolve();
  private readonly inflightScans = new Map<string, Promise<UsageHistorySummary>>();

  constructor(options: UsageHistoryServiceOptions) {
    this.logger = options.logger.child({ module: "usage-history" });
    const claudeConfigDir =
      options.claudeConfigDir ??
      process.env["CLAUDE_CONFIG_DIR"] ??
      path.join(homedir(), ".claude");
    const codexHome =
      options.codexHome ?? process.env["CODEX_HOME"] ?? path.join(homedir(), ".codex");
    this.getProviderConfigs = options.getProviderConfigs ?? (() => ({}));
    this.defaultSources = [
      { provider: "claude", dir: path.join(claudeConfigDir, "projects") },
      { provider: "codex", dir: path.join(codexHome, "sessions") },
    ];
    this.fetchApi = options.fetch ?? fetch;
    this.now = options.now ?? Date.now;
    const persistenceDir = path.join(options.paseoHome, "usage-history");
    this.scanCachePath = path.join(persistenceDir, "scan-cache.json");
    this.ratesCachePath = path.join(persistenceDir, "model-rates.json");
  }

  readSummary(input: UsageHistoryReadInput): Promise<UsageHistorySummary> {
    validateUsageHistoryWindow(input);
    const key = JSON.stringify([input.timeZone, input.sinceDay, input.untilDay]);
    const existing = this.inflightScans.get(key);
    if (existing) return existing;

    if (this.inflightScans.size >= MAX_PENDING_SCANS) throw new UsageHistoryBusyError();
    const scan = this.scanLock
      .then(() => this.scanSummary(input))
      .finally(() => {
        if (this.inflightScans.get(key) === scan) this.inflightScans.delete(key);
      });
    this.scanLock = scan.then(
      () => undefined,
      () => undefined,
    );
    this.inflightScans.set(key, scan);
    return scan;
  }

  async refreshRates(): Promise<ProviderUsageHistoryPricing> {
    await this.ensureRates(true);
    return this.pricing();
  }

  private async scanSummary(input: UsageHistoryReadInput): Promise<UsageHistorySummary> {
    const startedAtMs = this.now();
    await this.ensureScanCacheLoaded();
    const windowStartMs = Date.parse(`${input.sinceDay}T00:00:00Z`) - MTIME_SLACK_MS;

    const [, scannedSources] = await Promise.all([
      this.ensureRates(false),
      this.collectSources(windowStartMs),
    ]);
    const aggregator = new UsageAggregator({ ...input, rates: this.rates });
    const sources: ProviderUsageHistorySource[] = [];
    const livePaths = new Set<string>();
    const walkedRoots: string[] = [];

    for (const source of scannedSources) {
      if (source.status !== "ok") {
        sources.push({
          provider: source.provider,
          path: source.dir,
          status: source.status,
          scannedFiles: 0,
          skippedFiles: 0,
          distinctSessions: 0,
          message: source.message,
        });
        continue;
      }

      walkedRoots.push(source.dir);
      let scannedFiles = 0;
      let skippedFiles = 0;
      const sessionIds = new Set<string>();
      for (const file of source.files) {
        livePaths.add(file.path);
        if (file.records.length === 0) {
          skippedFiles += 1;
          continue;
        }
        scannedFiles += 1;
        for (const record of file.records) {
          if (aggregator.add(record) && record.sessionId.length > 0) {
            sessionIds.add(record.sessionId);
          }
        }
      }
      sources.push({
        provider: source.provider,
        path: source.dir,
        status: "ok",
        scannedFiles,
        skippedFiles,
        distinctSessions: sessionIds.size,
        message: null,
      });
    }

    const removed = pruneScanCache(this.fileCache, {
      livePaths,
      walkedRoots,
      windowStartMs,
      retentionCutoffMs: startedAtMs - CACHE_RETENTION_MS,
    });
    if (removed > 0) this.cacheDirty = true;
    await this.persistScanCache();

    const aggregated = aggregator.finish();
    const finishedAtMs = this.now();
    return {
      readAt: new Date(finishedAtMs).toISOString(),
      timeZone: input.timeZone,
      sinceDay: input.sinceDay,
      untilDay: input.untilDay,
      buckets: [...aggregated.buckets],
      sources,
      pricing: this.pricing(),
      scanDurationMs: Math.max(0, finishedAtMs - startedAtMs),
    };
  }

  private transcriptSources(): TranscriptSource[] {
    const sources = this.defaultSources.map((source) => ({ ...source }));
    for (const [id, config] of Object.entries(this.getProviderConfigs())) {
      const provider = config.extends ?? id;
      if (provider !== "claude" && provider !== "codex") continue;
      const env = config.env;
      if (typeof env !== "object" || env === null || Array.isArray(env)) continue;
      const variable = provider === "claude" ? "CLAUDE_CONFIG_DIR" : "CODEX_HOME";
      const home: unknown = Reflect.get(env, variable);
      if (typeof home !== "string" || home.length === 0) continue;
      const subdir = provider === "claude" ? "projects" : "sessions";
      sources.push({ provider, dir: path.resolve(expandTilde(home), subdir) });
    }
    return sources;
  }

  private async collectSources(windowStartMs: number): Promise<readonly ScannedSource[]> {
    const scanned: ScannedSource[] = [];
    const seenRoots = new Set<string>();
    const seenFiles = new Set<string>();
    for (const source of this.transcriptSources()) {
      let stats;
      try {
        source.dir = await fs.realpath(source.dir);
        const rootKey = `${source.provider}:${source.dir}`;
        if (seenRoots.has(rootKey)) continue;
        seenRoots.add(rootKey);
        stats = await fs.stat(source.dir);
      } catch (error) {
        const code = readErrorCode(error);
        const isMissing = code === "ENOENT" || code === "ENOTDIR";
        scanned.push({
          ...source,
          status: isMissing ? "missing" : "failed",
          files: [],
          message: isMissing
            ? "No transcript directory on this environment."
            : `Could not inspect transcript directory: ${errorMessage(error)}`,
        });
        continue;
      }
      if (!stats.isDirectory()) {
        scanned.push({
          ...source,
          status: "missing",
          files: [],
          message: "No transcript directory on this environment.",
        });
        continue;
      }

      let transcriptFiles;
      try {
        transcriptFiles = await listTranscriptFiles(source.dir, windowStartMs);
      } catch (error) {
        scanned.push({
          ...source,
          status: "failed",
          files: [],
          message: `Could not scan transcript directory: ${errorMessage(error)}`,
        });
        continue;
      }

      const files: ScannedFile[] = [];
      for (const file of transcriptFiles) {
        const fileKey = `${source.provider}:${file.path}`;
        if (seenFiles.has(fileKey)) continue;
        seenFiles.add(fileKey);
        files.push({
          path: file.path,
          records: await this.readFileRecords(file.path, file.size, file.mtimeMs, source.provider),
        });
      }
      scanned.push({ ...source, status: "ok", files, message: null });
    }
    return scanned;
  }

  private async readFileRecords(
    filePath: string,
    size: number,
    mtimeMs: number,
    provider: UsageProvider,
  ): Promise<readonly UsageRecord[]> {
    const cached = this.fileCache.get(filePath);
    if (
      cached &&
      cached.size === size &&
      cached.mtimeMs === mtimeMs &&
      cached.provider === provider
    ) {
      return combineRecords(cached);
    }

    const resumeFrom =
      cached !== undefined && cached.provider === provider && size > cached.size
        ? cached.position
        : undefined;
    const parsed = await readTranscriptRecords(filePath, provider, resumeFrom);
    // Caching a transient failure under this size/mtime would hide the file until it changes.
    if (parsed === null) return [];

    const base = parsed.resumed && cached !== undefined ? cached.records : [];
    const seen = new Set<string>();
    const records = dedupeWithinFile([...base, ...parsed.records], seen);
    const tailRecords = dedupeWithinFile(parsed.tailRecords, seen);
    const entry: CachedFile = {
      size,
      mtimeMs,
      provider,
      records,
      tailRecords,
      position: parsed.position,
    };
    this.fileCache.set(filePath, entry);
    this.cacheDirty = true;
    return combineRecords(entry);
  }

  /** Concurrent first readers share one disk load and never observe a half-loaded map. */
  private ensureScanCacheLoaded(): Promise<void> {
    if (!this.scanCacheLoad) this.scanCacheLoad = this.loadScanCache();
    return this.scanCacheLoad;
  }

  private async loadScanCache(): Promise<void> {
    try {
      const document = JSON.parse(await fs.readFile(this.scanCachePath, "utf8"));
      for (const [filePath, entry] of decodeScanCache(document)) {
        this.fileCache.set(filePath, entry);
      }
    } catch {
      // Missing or corrupt state only makes the first scan cold.
    }
  }

  private async persistScanCache(): Promise<void> {
    if (!this.cacheDirty) return;
    try {
      await writeFileAtomic(this.scanCachePath, JSON.stringify(encodeScanCache(this.fileCache)));
      this.cacheDirty = false;
    } catch (error) {
      this.logger.debug({ err: error }, "Failed to persist usage history scan cache");
    }
  }

  /** Serialized rate loads make refresh bursts share the first sufficiently recent table. */
  private ensureRates(force: boolean): Promise<void> {
    const operation = this.ratesLock.then(() => this.loadRates(force));
    this.ratesLock = operation.catch(() => undefined);
    return operation;
  }

  private async loadRates(force: boolean): Promise<void> {
    const nowMs = this.now();
    const maxAgeMs = force ? RATES_REFRESH_FLOOR_MS : RATES_TTL_MS;
    if (this.ratesFetchedAtMs !== null && nowMs - this.ratesFetchedAtMs < maxAgeMs) return;

    if (this.ratesFetchedAtMs === null) {
      const snapshot = await this.readRateSnapshot();
      if (snapshot) {
        const parsed = parseRateTable(snapshot.document);
        if (parsed.size > 0) {
          this.rates = parsed;
          this.ratesFetchedAtMs = snapshot.fetchedAtMs;
          this.ratesStatus = "cached";
          if (nowMs - snapshot.fetchedAtMs < maxAgeMs) return;
        }
      }
    }

    let document: unknown;
    try {
      const response = await this.fetchApi(LITELLM_RATES_URL, {
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      document = await response.json();
    } catch (error) {
      if (this.rates.size > 0) this.ratesStatus = "cached";
      this.logger.debug({ err: error }, "Failed to refresh usage history model rates");
      return;
    }

    const parsed = parseRateTable(document);
    if (parsed.size === 0) {
      if (this.rates.size > 0) this.ratesStatus = "cached";
      return;
    }
    this.rates = parsed;
    this.ratesFetchedAtMs = nowMs;
    this.ratesStatus = "fresh";
    try {
      await writeFileAtomic(
        this.ratesCachePath,
        JSON.stringify({ fetchedAtMs: nowMs, document } satisfies RateSnapshot),
      );
    } catch (error) {
      this.logger.debug({ err: error }, "Failed to persist usage history model rates");
    }
  }

  private async readRateSnapshot(): Promise<RateSnapshot | null> {
    try {
      const parsed: unknown = JSON.parse(await fs.readFile(this.ratesCachePath, "utf8"));
      if (typeof parsed !== "object" || parsed === null) return null;
      const candidate = parsed as Partial<RateSnapshot>;
      if (typeof candidate.fetchedAtMs !== "number" || !Number.isFinite(candidate.fetchedAtMs)) {
        return null;
      }
      return { fetchedAtMs: candidate.fetchedAtMs, document: candidate.document };
    } catch {
      return null;
    }
  }

  private pricing(): ProviderUsageHistoryPricing {
    return {
      status: this.ratesStatus,
      source: LITELLM_RATES_URL,
      fetchedAt:
        this.ratesFetchedAtMs === null ? null : new Date(this.ratesFetchedAtMs).toISOString(),
      knownModels: this.rates.size,
    };
  }
}

function combineRecords(entry: CachedFile): readonly UsageRecord[] {
  return entry.tailRecords.length === 0 ? entry.records : [...entry.records, ...entry.tailRecords];
}

function readErrorCode(error: unknown): string | null {
  if (typeof error !== "object" || error === null || !("code" in error)) return null;
  return typeof error.code === "string" ? error.code : null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

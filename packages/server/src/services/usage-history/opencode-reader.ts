import { promises as fs } from "node:fs";
import path from "node:path";
import type { Logger } from "pino";
import { parseOpenCodeMessage, type UsageRecord } from "./transcripts.js";

// OpenCode keeps usage in SQLite rather than JSONL: every assistant turn is a row in the `message`
// table of `<data-dir>/opencode*.db` (the filename carries the release channel, e.g.
// `opencode-stable.db`), with that turn's token deltas inline in the row's JSON `data`. The data
// directory follows `XDG_DATA_HOME` (`~/.local/share/opencode` when unset). Read it with
// node:sqlite so there is no dependency on a `sqlite3` CLI binary.

export interface OpenCodeDatabase {
  readonly path: string;
  readonly size: number;
  readonly mtimeMs: number;
}

export interface ReadOpenCodeDatabaseOptions {
  readonly logger: Logger;
  /** Inclusive millisecond bounds on `message.time_created`; unset reads the whole table. */
  readonly sinceMs?: number;
  readonly untilMs?: number;
}

// @types/node@20 predates the node:sqlite typings; declare the slice we use.
interface OpenCodeStatement {
  all(...params: unknown[]): readonly Record<string, unknown>[];
}
interface OpenCodeDatabaseHandle {
  prepare(sql: string): OpenCodeStatement;
  close(): void;
}
interface NodeSqliteModule {
  DatabaseSync: new (path: string, options?: { readOnly?: boolean }) => OpenCodeDatabaseHandle;
}

async function loadSqlite(logger: Logger): Promise<NodeSqliteModule | null> {
  // Held in a variable so TypeScript skips module resolution: @types/node@20 has no
  // node:sqlite typings yet, while the runtime (Node 22+) provides it.
  const sqliteSpecifier: string = "node:sqlite";
  try {
    return (await import(sqliteSpecifier)) as unknown as NodeSqliteModule;
  } catch (error) {
    logger.debug({ err: error }, "node:sqlite unavailable; cannot read OpenCode usage");
    return null;
  }
}

/** Database files live directly in the data directory; `-shm`/`-wal` sidecars never match. */
export async function listOpenCodeDatabases(
  dataDir: string,
  sinceMs: number,
): Promise<readonly OpenCodeDatabase[]> {
  let entries;
  try {
    entries = await fs.readdir(dataDir, { withFileTypes: true });
  } catch {
    return [];
  }
  const found: OpenCodeDatabase[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !/^opencode.*\.db$/.test(entry.name)) continue;
    const dbPath = path.join(dataDir, entry.name);
    try {
      const stats = await fs.stat(dbPath);
      if (stats.mtimeMs >= sinceMs) {
        found.push({ path: dbPath, size: stats.size, mtimeMs: stats.mtimeMs });
      }
    } catch {
      // The file vanished between readdir and stat.
    }
  }
  return found;
}

/**
 * Reads one OpenCode database. A null return means the database could not be read at all, so
 * callers must report the home as failed rather than as quietly empty.
 */
export async function readOpenCodeDatabase(
  dbPath: string,
  options: ReadOpenCodeDatabaseOptions,
): Promise<readonly UsageRecord[] | null> {
  const sqlite = await loadSqlite(options.logger);
  if (sqlite === null) return null;

  let handle: OpenCodeDatabaseHandle | undefined;
  try {
    handle = new sqlite.DatabaseSync(dbPath, { readOnly: true });
    const conditions: string[] = [];
    const params: number[] = [];
    if (options.sinceMs !== undefined) {
      conditions.push("time_created >= ?");
      params.push(options.sinceMs);
    }
    if (options.untilMs !== undefined) {
      conditions.push("time_created <= ?");
      params.push(options.untilMs);
    }
    const where = conditions.length === 0 ? "" : ` WHERE ${conditions.join(" AND ")}`;
    const rows = handle.prepare(`SELECT id, session_id, data FROM message${where}`).all(...params);
    const records: UsageRecord[] = [];
    for (const row of rows) {
      const id = row["id"];
      const sessionId = row["session_id"];
      const data = row["data"];
      if (typeof id !== "string" || typeof sessionId !== "string" || typeof data !== "string") {
        continue;
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(data);
      } catch {
        continue;
      }
      const record = parseOpenCodeMessage({ id, sessionId, data: parsed });
      if (record !== null) records.push(record);
    }
    return records;
  } catch (error) {
    options.logger.debug({ err: error, dbPath }, "Failed to read OpenCode usage database");
    return null;
  } finally {
    try {
      handle?.close();
    } catch {
      // Closing a half-opened handle must not fail the scan.
    }
  }
}

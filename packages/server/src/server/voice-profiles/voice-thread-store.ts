import { randomBytes } from "node:crypto";
import { readFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import {
  VOICE_THREAD_TITLE_MAX_LENGTH,
  VoiceThreadHistoryEntrySchema,
  VoiceThreadIdSchema,
  VoiceThreadSchema,
  type VoiceThread,
  type VoiceThreadHistoryEntry,
  type VoiceProfileRequest,
} from "@getpaseo/protocol/voice-profiles";
import { writeJsonFileAtomic } from "../atomic-file.js";
import { principalDirectoryName } from "./voice-profile-store.js";

type Input<T extends VoiceProfileRequest["type"]> = Omit<
  Extract<VoiceProfileRequest, { type: T }>,
  "type" | "requestId"
>;
type EntryInput<T = VoiceThreadHistoryEntry> = T extends VoiceThreadHistoryEntry
  ? Omit<T, "seq" | "callId" | "createdAt">
  : never;
const RecordSchema = z.object({
  thread: VoiceThreadSchema,
  history: z.array(VoiceThreadHistoryEntrySchema),
  archives: z.array(z.string().regex(/^\d+-\d+\.json$/)).optional(),
});
type ThreadRecord = z.infer<typeof RecordSchema>;

export class VoiceThreadStoreError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export interface VoiceThreadCallHandle {
  readonly thread: VoiceThread;
  readonly history: VoiceThreadHistoryEntry[];
  append(entry: EntryInput): Promise<void>;
  close(cause: string): Promise<void>;
}

function missing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

/** The first thing the user says names the thread until they rename it. */
function deriveTitle(text: string): string {
  const line = text.trim().split(/\s+/).join(" ");
  return line.length > VOICE_THREAD_TITLE_MAX_LENGTH
    ? `${line.slice(0, VOICE_THREAD_TITLE_MAX_LENGTH - 1)}…`
    : line;
}

/**
 * Threads are per-principal journals under `directory/{hash}/threads`. A
 * thread holds its history and a user-written summary checkpoint; the profile
 * that configures its calls is referenced by id and resolved at call start, so
 * editing a profile applies to every thread's next call.
 */
export class VoiceThreadStore {
  private readonly mutations = new Map<string, Promise<unknown>>();
  private readonly calls = new Map<
    string,
    { handle: VoiceThreadCallHandle; onDeleted: () => void | Promise<void> }
  >();
  private readonly deleting = new Map<string, Promise<void>>();

  constructor(private readonly directory: string) {}

  private principalDirectory(principal: string): string {
    if (!principal)
      throw new VoiceThreadStoreError("unauthorized", "Thread ownership is unavailable");
    return join(this.directory, principalDirectoryName(principal), "threads");
  }

  private path(principal: string, id: string): string {
    VoiceThreadIdSchema.parse(id);
    return join(this.principalDirectory(principal), `${id}.json`);
  }

  private serial<T>(key: string, task: () => Promise<T>): Promise<T> {
    const work = (this.mutations.get(key) ?? Promise.resolve()).catch(() => {}).then(task);
    this.mutations.set(key, work);
    void work
      .finally(() => {
        if (this.mutations.get(key) === work) this.mutations.delete(key);
      })
      .catch(() => {});
    return work;
  }

  async flush(): Promise<void> {
    while (this.mutations.size) await Promise.all(this.mutations.values());
  }

  private async read<T>(path: string, schema: z.ZodType<T>): Promise<T> {
    try {
      return schema.parse(JSON.parse(await readFile(path, "utf8")));
    } catch (error) {
      if (missing(error)) throw new VoiceThreadStoreError("not_found", "Thread not found");
      throw error;
    }
  }

  private async paths(principal: string): Promise<string[]> {
    const directory = this.principalDirectory(principal);
    try {
      return (await readdir(directory))
        .filter((name) => /^thr_[a-f0-9]{32}\.json$/.test(name))
        .map((name) => join(directory, name));
    } catch (error) {
      if (missing(error)) return [];
      throw error;
    }
  }

  private async history(path: string, record: ThreadRecord): Promise<VoiceThreadHistoryEntry[]> {
    const archived = await Promise.all(
      (record.archives ?? []).map((file) =>
        this.read(join(`${path}.history`, file), z.array(VoiceThreadHistoryEntrySchema)),
      ),
    );
    return [...archived.flat(), ...record.history];
  }

  private async writeRecord(path: string, record: ThreadRecord): Promise<void> {
    const summarized = record.history.filter(
      (entry) => entry.seq <= record.thread.summaryThroughSeq,
    ).length;
    const archiveCount = Math.max(summarized, record.history.length > 512 ? 256 : 0);
    if (archiveCount > 0) {
      const entries = record.history.slice(0, archiveCount);
      const file = `${entries[0]!.seq}-${entries.at(-1)!.seq}.json`;
      // Write the immutable segment first. Only the atomic manifest replacement
      // makes it authoritative; an interrupted write cannot lose history.
      await writeJsonFileAtomic(join(`${path}.history`, file), entries);
      record.archives = [...(record.archives ?? []), file];
      record.history = record.history.slice(archiveCount);
    }
    await writeJsonFileAtomic(path, record);
  }

  /** Most recently active first. */
  async list(principal: string): Promise<VoiceThread[]> {
    const entries = await Promise.all(
      (await this.paths(principal)).map(async (path) => {
        try {
          return (await this.read(path, RecordSchema)).thread;
        } catch (error) {
          if (error instanceof VoiceThreadStoreError && error.code === "not_found") return null;
          throw error;
        }
      }),
    );
    return entries
      .filter((entry): entry is VoiceThread => entry !== null)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async get(principal: string, id: string, page: { beforeSeq?: number; limit?: number } = {}) {
    const path = this.path(principal, id);
    await this.mutations.get(path);
    const record = await this.read(path, RecordSchema);
    const candidates = (await this.history(path, record)).filter(
      (entry) => page.beforeSeq === undefined || entry.seq < page.beforeSeq,
    );
    const limit = Math.min(200, Math.max(1, page.limit ?? 50));
    return {
      thread: record.thread,
      history: candidates.slice(-limit),
      hasMore: candidates.length > limit,
    };
  }

  async create(principal: string, input: { profileId: string | null }): Promise<VoiceThread> {
    const now = new Date().toISOString();
    const thread = VoiceThreadSchema.parse({
      id: `thr_${randomBytes(16).toString("hex")}`,
      profileId: input.profileId,
      title: "",
      revision: 1,
      createdAt: now,
      updatedAt: now,
      summary: "",
      summaryThroughSeq: 0,
      lastSeq: 0,
    });
    await writeJsonFileAtomic(this.path(principal, thread.id), { thread, history: [] });
    return thread;
  }

  private mutate(
    principal: string,
    id: string,
    change: (record: ThreadRecord) => void,
  ): Promise<VoiceThread> {
    const path = this.path(principal, id);
    return this.serial(path, async () => {
      if (this.deleting.has(path))
        throw new VoiceThreadStoreError("not_found", "Thread is being deleted");
      const record = await this.read(path, RecordSchema);
      change(record);
      const parsed = RecordSchema.parse(record);
      await this.writeRecord(path, parsed);
      return parsed.thread;
    });
  }

  private checkRevision(thread: { revision: number }, expected: number | undefined): void {
    if (thread.revision !== expected)
      throw new VoiceThreadStoreError("conflict", "This thread changed. Reload before saving.");
  }

  update(principal: string, input: Input<"voice.thread.update.request">): Promise<VoiceThread> {
    return this.mutate(principal, input.threadId, (record) => {
      this.checkRevision(record.thread, input.expectedRevision);
      Object.assign(record.thread, {
        title: input.title.trim(),
        revision: record.thread.revision + 1,
        updatedAt: new Date().toISOString(),
      });
    });
  }

  compact(principal: string, input: Input<"voice.thread.compact.request">): Promise<VoiceThread> {
    return this.mutate(principal, input.threadId, (record) => {
      this.checkRevision(record.thread, input.expectedRevision);
      if (
        input.throughSeq < record.thread.summaryThroughSeq ||
        input.throughSeq > record.thread.lastSeq
      )
        throw new VoiceThreadStoreError(
          "invalid_checkpoint",
          "Choose a checkpoint within the saved history",
        );
      Object.assign(record.thread, {
        summary: input.summary,
        summaryThroughSeq: input.throughSeq,
        revision: record.thread.revision + 1,
        updatedAt: new Date().toISOString(),
      });
    });
  }

  async openCall(
    principal: string,
    id: string,
    callId: string,
    onDeleted: () => void | Promise<void>,
  ): Promise<VoiceThreadCallHandle> {
    const path = this.path(principal, id);
    return this.serial(path, async () => {
      if (this.deleting.has(path))
        throw new VoiceThreadStoreError("not_found", "Thread is being deleted");
      const record = await this.read(path, RecordSchema);
      if (this.calls.has(path))
        throw new VoiceThreadStoreError("thread_busy", "This thread already has an active call");
      const history = await this.history(path, record);
      const lastStart = history.findLast((entry) => entry.kind === "call_started");
      if (
        lastStart &&
        !history.some((entry) => entry.kind === "call_ended" && entry.callId === lastStart.callId)
      ) {
        this.addEntry(record, lastStart.callId, { kind: "call_ended", cause: "daemon_restarted" });
        history.push(record.history.at(-1)!);
      }
      let closed = false;
      let closing: Promise<void> | undefined;
      const append = (entry: EntryInput) =>
        this.serial(path, async () => {
          const current = await this.read(path, RecordSchema);
          this.addEntry(current, callId, entry);
          await this.writeRecord(path, current);
        });
      const handle: VoiceThreadCallHandle = {
        thread: structuredClone(record.thread),
        history: structuredClone(history),
        append: (entry) => (closed || this.deleting.has(path) ? Promise.resolve() : append(entry)),
        close: (cause) => {
          closed = true;
          if (!closing) {
            closing = append({ kind: "call_ended", cause }).then(() => {
              if (this.calls.get(path)?.handle === handle) this.calls.delete(path);
              return;
            });
            void closing.catch(() => {
              closing = undefined;
            });
          }
          return closing;
        },
      };
      this.addEntry(record, callId, { kind: "call_started" });
      await this.writeRecord(path, record);
      this.calls.set(path, { handle, onDeleted });
      return handle;
    });
  }

  private addEntry(record: ThreadRecord, callId: string, entry: EntryInput): void {
    const createdAt = new Date().toISOString();
    record.history.push(
      VoiceThreadHistoryEntrySchema.parse({
        ...entry,
        callId,
        seq: ++record.thread.lastSeq,
        createdAt,
      }),
    );
    if (record.thread.title === "" && entry.kind === "transcript" && entry.role === "user") {
      record.thread.title = deriveTitle(entry.text);
    }
    record.thread.updatedAt = createdAt;
  }

  async delete(principal: string, id: string): Promise<void> {
    const path = this.path(principal, id);
    const pending = this.deleting.get(path);
    if (pending) return pending;
    const work = Promise.resolve().then(async () => {
      // Wait for a call reservation that was already writing its start entry.
      await this.serial(path, async () => {});
      const call = this.calls.get(path);
      if (call) {
        await call.onDeleted();
        await call.handle.close("thread_deleted");
      }
      await this.serial(path, async () => {
        await rm(path, { force: true });
        await rm(`${path}.history`, { recursive: true, force: true });
      });
      return;
    });
    this.deleting.set(path, work);
    try {
      await work;
    } finally {
      this.deleting.delete(path);
    }
  }
}

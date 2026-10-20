import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { VoiceThreadStore } from "./voice-thread-store.js";

describe("VoiceThreadStore", () => {
  let dir: string;
  let store: VoiceThreadStore;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "paseo-voice-threads-"));
    store = new VoiceThreadStore(dir);
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("isolates threads by principal and rejects path traversal", async () => {
    const thread = await store.create("alice", { profileId: "cfg_work" });
    expect(await store.list("bob")).toEqual([]);
    await expect(store.get("bob", thread.id)).rejects.toMatchObject({ code: "not_found" });
    await expect(store.openCall("bob", thread.id, "call", () => {})).rejects.toMatchObject({
      code: "not_found",
    });
    await expect(store.get("alice", "../../outside")).rejects.toThrow();
    await store.delete("bob", thread.id);
    expect((await store.get("alice", thread.id)).thread.profileId).toBe("cfg_work");
  });

  it("titles a thread from its first utterance until the user renames it", async () => {
    const thread = await store.create("owner", { profileId: null });
    const call = await store.openCall("owner", thread.id, "call-1", () => {});
    await call.append({ kind: "transcript", role: "assistant", text: "Hello" });
    await call.append({ kind: "transcript", role: "user", text: "  Plan the   release " });
    await call.append({ kind: "transcript", role: "user", text: "Second thing" });
    await call.close("requested");
    expect((await store.get("owner", thread.id)).thread.title).toBe("Plan the release");
    const renamed = await store.update("owner", {
      threadId: thread.id,
      expectedRevision: 1,
      title: "Release",
    });
    expect(renamed.title).toBe("Release");
    await expect(
      store.update("owner", { threadId: thread.id, expectedRevision: 1, title: "Stale" }),
    ).rejects.toMatchObject({ code: "conflict" });
  });

  it("journals ordered calls, pages history, and compacts without deleting the original", async () => {
    const thread = await store.create("owner", { profileId: null });
    const call = await store.openCall("owner", thread.id, "call-1", () => {});
    await Promise.all([
      call.append({ kind: "transcript", role: "user", text: "Remember Iris" }),
      call.append({ kind: "transcript", role: "assistant", text: "Iris" }),
    ]);
    await call.close("requested");
    const compacted = await store.compact("owner", {
      threadId: thread.id,
      expectedRevision: 1,
      throughSeq: 3,
      summary: "The project is Iris.",
    });
    expect(compacted.summaryThroughSeq).toBe(3);
    const restored = new VoiceThreadStore(dir);
    const page = await restored.get("owner", thread.id, { limit: 2 });
    expect(page.history.map((entry) => entry.seq)).toEqual([3, 4]);
    expect(page.hasMore).toBe(true);
    const older = await restored.get("owner", thread.id, { beforeSeq: 3, limit: 2 });
    expect(older.history.map((entry) => entry.seq)).toEqual([1, 2]);
    expect(older.hasMore).toBe(false);
    const next = await restored.openCall("owner", thread.id, "call-2", () => {});
    expect(next.thread.summary).toBe("The project is Iris.");
    expect(
      next.history.some((entry) => entry.kind === "transcript" && entry.text === "Remember Iris"),
    ).toBe(true);
    await next.close("requested");
  });

  it("refuses simultaneous calls and lists most recent first", async () => {
    const older = await store.create("owner", { profileId: null });
    const newer = await store.create("owner", { profileId: null });
    const first = await store.openCall("owner", older.id, "call-1", () => {});
    await expect(store.openCall("owner", older.id, "call-2", () => {})).rejects.toMatchObject({
      code: "thread_busy",
    });
    await first.close("requested");
    expect((await store.list("owner")).map((thread) => thread.id)).toEqual([older.id, newer.id]);
  });

  it("drains pending history and closes only its own call on deletion", async () => {
    const thread = await store.create("owner", { profileId: null });
    let closed = 0;
    const call = await store.openCall("owner", thread.id, "call-1", () => {
      closed++;
    });
    const writing = call.append({ kind: "transcript", role: "user", text: "Pending" });
    await store.delete("owner", thread.id);
    await writing;
    await call.append({ kind: "transcript", role: "assistant", text: "Late" });
    await call.close("requested");
    expect(closed).toBe(1);
    expect(await store.list("owner")).toEqual([]);
    await expect(store.get("owner", thread.id)).rejects.toMatchObject({ code: "not_found" });
  });

  it("marks a call interrupted by daemon restart and retains archived history", async () => {
    const thread = await store.create("owner", { profileId: null });
    const oldCall = await store.openCall("owner", thread.id, "old-call", () => {});
    await Promise.all(
      Array.from({ length: 513 }, (_, index) =>
        oldCall.append({ kind: "transcript", role: "user", text: `Message ${index}` }),
      ),
    );
    const restarted = new VoiceThreadStore(dir);
    const next = await restarted.openCall("owner", thread.id, "new-call", () => {});
    await next.close("requested");
    const oldPage = await restarted.get("owner", thread.id, { beforeSeq: 10, limit: 20 });
    expect(oldPage.history.map((entry) => entry.seq)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    const latest = await restarted.get("owner", thread.id);
    expect(latest.history).toEqual(
      expect.arrayContaining([
        {
          kind: "call_ended",
          callId: "old-call",
          seq: 515,
          createdAt: expect.any(String),
          cause: "daemon_restarted",
        },
      ]),
    );
    await restarted.delete("owner", thread.id);
    expect(await restarted.list("owner")).toEqual([]);
  });
});

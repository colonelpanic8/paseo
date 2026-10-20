import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_VOICE_PROFILE_CONFIGURATION,
  type VoiceProfile,
} from "@getpaseo/protocol/voice-profiles";
import { VoiceProfileStore } from "./voice-profile-store.js";

const declared: VoiceProfile = {
  id: "cfg_work",
  name: "Work",
  source: "config",
  configuration: { ...DEFAULT_VOICE_PROFILE_CONFIGURATION, files: ["~/org/work.org"] },
  revision: 1,
  createdAt: "now",
  updatedAt: "now",
};

describe("VoiceProfileStore", () => {
  let dir: string;
  let store: VoiceProfileStore;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "paseo-voice-profiles-"));
    store = new VoiceProfileStore(dir, { profiles: [declared], defaultProfileId: "cfg_work" });
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("lists declared profiles first, then stored ones by name, for every principal", async () => {
    const zed = await store.save("alice", {
      name: "Zed",
      configuration: DEFAULT_VOICE_PROFILE_CONFIGURATION,
    });
    const alpha = await store.save("alice", {
      name: "Alpha",
      configuration: DEFAULT_VOICE_PROFILE_CONFIGURATION,
    });
    expect((await store.list("alice")).map((profile) => profile.id)).toEqual([
      declared.id,
      alpha.id,
      zed.id,
    ]);
    expect((await store.list("bob")).map((profile) => profile.id)).toEqual([declared.id]);
    expect(store.defaultProfileId).toBe("cfg_work");
    expect(await store.find("bob", declared.id)).toEqual(declared);
    expect(await store.find("bob", alpha.id)).toBeNull();
    expect(await new VoiceProfileStore(dir).find("alice", alpha.id)).toEqual(alpha);
  });

  it("refuses to edit declared profiles and rejects stale saves", async () => {
    await expect(
      store.save("alice", {
        profileId: declared.id,
        expectedRevision: 1,
        name: "Renamed",
        configuration: declared.configuration,
      }),
    ).rejects.toMatchObject({ code: "read_only" });
    await expect(store.delete("alice", declared.id)).rejects.toMatchObject({ code: "read_only" });
    const own = await store.save("alice", {
      name: "Own",
      configuration: DEFAULT_VOICE_PROFILE_CONFIGURATION,
    });
    const edited = await store.save("alice", {
      profileId: own.id,
      expectedRevision: own.revision,
      name: "Own v2",
      configuration: { ...own.configuration, instructions: "Be brief" },
    });
    expect(edited.revision).toBe(2);
    await expect(
      store.save("alice", {
        profileId: own.id,
        expectedRevision: 1,
        name: "Stale",
        configuration: own.configuration,
      }),
    ).rejects.toMatchObject({ code: "conflict" });
    await expect(store.find("alice", "../../outside")).resolves.toBeNull();
    await store.delete("alice", own.id);
    expect(await store.find("alice", own.id)).toBeNull();
  });
});

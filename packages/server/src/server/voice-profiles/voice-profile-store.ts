import { createHash, randomBytes } from "node:crypto";
import { readFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import {
  VoiceProfileIdSchema,
  VoiceProfileSchema,
  type VoiceProfile,
  type VoiceProfileRequest,
} from "@getpaseo/protocol/voice-profiles";
import { writeJsonFileAtomic } from "../atomic-file.js";

type Input<T extends VoiceProfileRequest["type"]> = Omit<
  Extract<VoiceProfileRequest, { type: T }>,
  "type" | "requestId"
>;

export class VoiceProfileStoreError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/** Profiles declared in the daemon's config.json; read-only and shared by every principal. */
export interface DeclaredVoiceProfiles {
  profiles: readonly VoiceProfile[];
  defaultProfileId: string | null;
}

function missing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

export function principalDirectoryName(principal: string): string {
  return createHash("sha256").update(principal).digest("hex");
}

/**
 * User-created profiles live per principal under `directory/{hash}/profiles`.
 * Declared profiles are merged into every list so a client sees one set; their
 * `cfg_` ids never reach the filesystem.
 */
export class VoiceProfileStore {
  private readonly mutations = new Map<string, Promise<unknown>>();
  private readonly declared: DeclaredVoiceProfiles;

  constructor(
    private readonly directory: string,
    declared?: DeclaredVoiceProfiles,
  ) {
    this.declared = declared ?? { profiles: [], defaultProfileId: null };
  }

  get defaultProfileId(): string | null {
    return this.declared.defaultProfileId;
  }

  private principalDirectory(principal: string): string {
    if (!principal)
      throw new VoiceProfileStoreError("unauthorized", "Profile ownership is unavailable");
    return join(this.directory, principalDirectoryName(principal), "profiles");
  }

  private path(principal: string, id: string): string {
    VoiceProfileIdSchema.parse(id);
    if (!id.startsWith("prf_"))
      throw new VoiceProfileStoreError("read_only", "Profiles from config.json cannot be edited");
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

  private async read(path: string): Promise<VoiceProfile> {
    try {
      return VoiceProfileSchema.parse(JSON.parse(await readFile(path, "utf8")));
    } catch (error) {
      if (missing(error)) throw new VoiceProfileStoreError("not_found", "Profile not found");
      throw error;
    }
  }

  async list(principal: string): Promise<VoiceProfile[]> {
    const directory = this.principalDirectory(principal);
    let names: string[];
    try {
      names = (await readdir(directory)).filter((name) => /^prf_[a-f0-9]{32}\.json$/.test(name));
    } catch (error) {
      if (!missing(error)) throw error;
      names = [];
    }
    const stored = await Promise.all(
      names.map(async (name) => {
        try {
          return await this.read(join(directory, name));
        } catch (error) {
          if (error instanceof VoiceProfileStoreError && error.code === "not_found") return null;
          throw error;
        }
      }),
    );
    return [
      ...this.declared.profiles,
      ...stored
        .filter((entry): entry is VoiceProfile => entry !== null)
        .sort((a, b) => a.name.localeCompare(b.name)),
    ];
  }

  /** Null when the id names nothing this principal can see. */
  async find(principal: string, id: string): Promise<VoiceProfile | null> {
    if (!VoiceProfileIdSchema.safeParse(id).success) return null;
    const declared = this.declared.profiles.find((profile) => profile.id === id);
    if (declared) return declared;
    if (!id.startsWith("prf_")) return null;
    try {
      return await this.read(join(this.principalDirectory(principal), `${id}.json`));
    } catch (error) {
      if (error instanceof VoiceProfileStoreError && error.code === "not_found") return null;
      throw error;
    }
  }

  async save(principal: string, input: Input<"voice.profile.save.request">): Promise<VoiceProfile> {
    const id = input.profileId ?? `prf_${randomBytes(16).toString("hex")}`;
    const path = this.path(principal, id);
    return this.serial(path, async () => {
      const previous = input.profileId ? await this.read(path) : null;
      if (previous && previous.revision !== input.expectedRevision)
        throw new VoiceProfileStoreError("conflict", "This profile changed. Reload before saving.");
      const now = new Date().toISOString();
      const profile = VoiceProfileSchema.parse({
        id,
        name: input.name,
        source: "user",
        configuration: input.configuration,
        revision: (previous?.revision ?? 0) + 1,
        createdAt: previous?.createdAt ?? now,
        updatedAt: now,
      });
      await writeJsonFileAtomic(path, profile);
      return profile;
    });
  }

  async delete(principal: string, id: string): Promise<void> {
    const path = this.path(principal, id);
    await this.serial(path, () => rm(path, { force: true }));
  }

  async flush(): Promise<void> {
    while (this.mutations.size) await Promise.all(this.mutations.values());
  }
}

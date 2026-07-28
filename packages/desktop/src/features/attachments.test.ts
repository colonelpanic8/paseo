import { mkdir, mkdtemp, readdir, readFile, rm, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  copyAttachmentFileToManagedStorage,
  garbageCollectManagedAttachmentFiles,
} from "./attachments";

const PREVIEW_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

const originalPaseoHome = process.env.PASEO_HOME;
let testHome: string | null = null;

async function useTempPaseoHome(): Promise<string> {
  testHome = await mkdtemp(path.join(os.tmpdir(), "paseo-desktop-attachments-"));
  process.env.PASEO_HOME = testHome;
  return testHome;
}

describe("desktop attachment files", () => {
  afterEach(async () => {
    if (originalPaseoHome === undefined) {
      delete process.env.PASEO_HOME;
    } else {
      process.env.PASEO_HOME = originalPaseoHome;
    }

    if (testHome) {
      await rm(testHome, { recursive: true, force: true });
      testHome = null;
    }
  });

  it("accepts dot-prefixed picker extensions for managed copies", async () => {
    const paseoHome = await useTempPaseoHome();
    const sourcePath = path.join(paseoHome, "report.md");
    await writeFile(sourcePath, "# Report\n");

    const result = await copyAttachmentFileToManagedStorage({
      attachmentId: "att_markdown",
      sourcePath,
      extension: ".md",
    });

    expect(result).toEqual({
      path: path.join(paseoHome, "desktop-attachments", "att_markdown.md"),
      byteSize: 9,
    });
    await expect(readFile(result.path, "utf8")).resolves.toBe("# Report\n");
  });

  it("normalizes legacy bare extensions for managed copies", async () => {
    const paseoHome = await useTempPaseoHome();
    const sourcePath = path.join(paseoHome, "report.md");
    await writeFile(sourcePath, "# Report\n");

    const result = await copyAttachmentFileToManagedStorage({
      attachmentId: "att_markdown_legacy",
      sourcePath,
      extension: "md",
    });

    expect(result).toEqual({
      path: path.join(paseoHome, "desktop-attachments", "att_markdown_legacy.md"),
      byteSize: 9,
    });
    await expect(readFile(result.path, "utf8")).resolves.toBe("# Report\n");
  });

  describe("garbageCollectManagedAttachmentFiles", () => {
    async function seedAttachmentsDir(
      paseoHome: string,
      files: readonly { name: string; ageMs?: number }[],
    ): Promise<string> {
      const dirPath = path.join(paseoHome, "desktop-attachments");
      await mkdir(dirPath, { recursive: true });
      for (const file of files) {
        const filePath = path.join(dirPath, file.name);
        await writeFile(filePath, "bytes");
        if (file.ageMs !== undefined) {
          const seconds = (Date.now() - file.ageMs) / 1000;
          await utimes(filePath, seconds, seconds);
        }
      }
      return dirPath;
    }

    it("keeps unreferenced previews so composer edits do not evict rendered images", async () => {
      const paseoHome = await useTempPaseoHome();
      const dirPath = await seedAttachmentsDir(paseoHome, [
        { name: "preview_4_abc.png" },
        { name: "att_unreferenced.png" },
        { name: "att_kept.png" },
      ]);

      const deleted = await garbageCollectManagedAttachmentFiles({
        referencedIds: ["att_kept"],
      });

      expect(deleted).toBe(1);
      expect((await readdir(dirPath)).sort()).toEqual(["att_kept.png", "preview_4_abc.png"]);
    });

    it("evicts previews older than the max age", async () => {
      const paseoHome = await useTempPaseoHome();
      const dirPath = await seedAttachmentsDir(paseoHome, [
        { name: "preview_4_fresh.png", ageMs: 0 },
        { name: "preview_4_stale.png", ageMs: PREVIEW_MAX_AGE_MS + 60_000 },
      ]);

      const deleted = await garbageCollectManagedAttachmentFiles({ referencedIds: [] });

      expect(deleted).toBe(1);
      expect(await readdir(dirPath)).toEqual(["preview_4_fresh.png"]);
    });
  });
});

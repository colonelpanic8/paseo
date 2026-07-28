import { File } from "expo-file-system";
import * as FileSystem from "expo-file-system/legacy";

export type AttachmentFileInfo =
  | {
      exists: true;
      isDirectory: boolean;
      size: number | null;
      /** Epoch milliseconds, or null when the platform does not report one. */
      modificationTimeMs: number | null;
    }
  | { exists: false };

export interface AttachmentFileSystem {
  readonly cacheDirectory: string | null;
  getInfo(uri: string): Promise<AttachmentFileInfo>;
  makeDirectory(uri: string, options: { intermediates: boolean }): Promise<void>;
  writeBytes(uri: string, bytes: Uint8Array): Promise<void>;
  copy(input: { from: string; to: string }): Promise<void>;
  readAsBase64(uri: string): Promise<string>;
  delete(uri: string, options: { idempotent: boolean }): Promise<void>;
  listDirectory(uri: string): Promise<string[]>;
}

export function createExpoAttachmentFileSystem(): AttachmentFileSystem {
  return {
    cacheDirectory: FileSystem.cacheDirectory,
    async getInfo(uri) {
      const info = await FileSystem.getInfoAsync(uri);
      if (!info.exists) {
        return { exists: false };
      }
      const size =
        typeof (info as { size?: number }).size === "number"
          ? (info as { size: number }).size
          : null;
      // expo-file-system reports modificationTime in seconds.
      const modificationTime = (info as { modificationTime?: number }).modificationTime;
      return {
        exists: true,
        isDirectory: info.isDirectory ?? false,
        size,
        modificationTimeMs: typeof modificationTime === "number" ? modificationTime * 1000 : null,
      };
    },
    async makeDirectory(uri, options) {
      await FileSystem.makeDirectoryAsync(uri, options);
    },
    async writeBytes(uri, bytes) {
      new File(uri).write(bytes);
    },
    async copy(input) {
      await FileSystem.copyAsync(input);
    },
    async readAsBase64(uri) {
      return await FileSystem.readAsStringAsync(uri, {
        encoding: FileSystem.EncodingType.Base64,
      });
    },
    async delete(uri, options) {
      await FileSystem.deleteAsync(uri, options);
    },
    async listDirectory(uri) {
      return await FileSystem.readDirectoryAsync(uri);
    },
  };
}

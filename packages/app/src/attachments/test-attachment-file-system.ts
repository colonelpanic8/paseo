import type { AttachmentFileInfo, AttachmentFileSystem } from "./attachment-file-system";

export interface TestAttachmentFileSystem extends AttachmentFileSystem {
  readonly files: ReadonlyMap<string, Uint8Array>;
  readonly directories: ReadonlySet<string>;
  setFile(uri: string, bytes: Uint8Array): void;
  setDirectory(uri: string): void;
  setModificationTimeMs(uri: string, modificationTimeMs: number): void;
}

export function createTestAttachmentFileSystem(options?: {
  cacheDirectory?: string | null;
}): TestAttachmentFileSystem {
  const files = new Map<string, Uint8Array>();
  const directories = new Set<string>();
  const modificationTimesMs = new Map<string, number>();
  const cacheDirectory =
    options && Object.hasOwn(options, "cacheDirectory")
      ? (options.cacheDirectory ?? null)
      : "file:///cache/";

  function describe(uri: string): AttachmentFileInfo {
    if (directories.has(uri) || directories.has(stripTrailingSlash(uri))) {
      return { exists: true, isDirectory: true, size: null, modificationTimeMs: null };
    }
    const bytes = files.get(uri);
    if (bytes) {
      return {
        exists: true,
        isDirectory: false,
        size: bytes.byteLength,
        modificationTimeMs: modificationTimesMs.get(uri) ?? null,
      };
    }
    return { exists: false };
  }

  return {
    files,
    directories,
    cacheDirectory,
    setFile(uri, bytes) {
      files.set(uri, bytes);
    },
    setDirectory(uri) {
      directories.add(stripTrailingSlash(uri));
    },
    setModificationTimeMs(uri, modificationTimeMs) {
      modificationTimesMs.set(uri, modificationTimeMs);
    },
    async getInfo(uri) {
      return describe(uri);
    },
    async makeDirectory(uri) {
      directories.add(stripTrailingSlash(uri));
    },
    async writeBytes(uri, bytes) {
      files.set(uri, bytes);
    },
    async copy({ from, to }) {
      const bytes = files.get(from);
      if (!bytes) {
        throw new Error(`copy: source does not exist: ${from}`);
      }
      files.set(to, bytes);
    },
    async readAsBase64(uri) {
      const bytes = files.get(uri);
      if (!bytes) {
        throw new Error(`readAsBase64: file does not exist: ${uri}`);
      }
      return toBase64(bytes);
    },
    async delete(uri, deleteOptions) {
      modificationTimesMs.delete(uri);
      if (!files.delete(uri) && !deleteOptions.idempotent) {
        throw new Error(`delete: file does not exist: ${uri}`);
      }
    },
    async listDirectory(uri) {
      const prefix = uri.endsWith("/") ? uri : `${uri}/`;
      const entries: string[] = [];
      for (const path of files.keys()) {
        if (path.startsWith(prefix)) {
          entries.push(path.slice(prefix.length));
        }
      }
      return entries;
    },
  };
}

function stripTrailingSlash(uri: string): string {
  return uri.endsWith("/") ? uri.slice(0, -1) : uri;
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  if (typeof btoa === "function") {
    return btoa(binary);
  }
  return Buffer.from(binary, "binary").toString("base64");
}

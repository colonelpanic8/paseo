import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  dedupeTranscriptHomes,
  resolveTranscriptHomes,
  resolveUsageProviderKind,
} from "./provider-homes.js";

let root: string;
const defaultHomes = { claude: "/defaults/claude", codex: "/defaults/codex" };

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "usage-homes-test-"));
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe("resolveUsageProviderKind", () => {
  it("follows extends until it reaches a transcript-keeping built-in", () => {
    const overrides = {
      "codex-ben": { extends: "codex" },
      "codex-ben-fast": { extends: "codex-ben" },
      "copilot-work": { extends: "copilot" },
      "acp-thing": { extends: "acp" },
      orphan: { label: "no extends" },
    };
    expect(resolveUsageProviderKind("codex-ben-fast", overrides)).toBe("codex");
    expect(resolveUsageProviderKind("claude", overrides)).toBe("claude");
    expect(resolveUsageProviderKind("copilot-work", overrides)).toBe(null);
    expect(resolveUsageProviderKind("acp-thing", overrides)).toBe(null);
    expect(resolveUsageProviderKind("orphan", overrides)).toBe(null);
  });

  it("resolves nothing for a cycle instead of looping", () => {
    const overrides = {
      "loop-a": { extends: "loop-b" },
      "loop-b": { extends: "loop-a" },
      "self-loop": { extends: "self-loop" },
    };
    expect(resolveUsageProviderKind("loop-a", overrides)).toBe(null);
    expect(resolveUsageProviderKind("self-loop", overrides)).toBe(null);
  });
});

describe("resolveTranscriptHomes", () => {
  it("lists the built-in defaults first, then configured providers in config order", () => {
    const homes = resolveTranscriptHomes({
      defaultHomes,
      overrides: {
        "codex-ben": { extends: "codex", label: "Codex (Ben)", env: { CODEX_HOME: "/ben" } },
        "claude-dean": {
          extends: "claude",
          label: "Claude (Dean)",
          env: { CLAUDE_CONFIG_DIR: "/dean" },
        },
      },
    });
    expect(homes).toEqual([
      {
        provider: "claude",
        providerId: "claude",
        label: "Claude",
        home: "/defaults/claude",
        dir: path.join("/defaults/claude", "projects"),
      },
      {
        provider: "codex",
        providerId: "codex",
        label: "Codex",
        home: "/defaults/codex",
        dir: path.join("/defaults/codex", "sessions"),
      },
      {
        provider: "codex",
        providerId: "codex-ben",
        label: "Codex (Ben)",
        home: "/ben",
        dir: path.join("/ben", "sessions"),
      },
      {
        provider: "claude",
        providerId: "claude-dean",
        label: "Claude (Dean)",
        home: "/dean",
        dir: path.join("/dean", "projects"),
      },
    ]);
  });

  it("keeps the default home for a provider that sets no home of its own", () => {
    const [, , inherited] = resolveTranscriptHomes({
      defaultHomes,
      overrides: { "codex-alt": { extends: "codex", env: { OTHER: "x" } } },
    });
    expect(inherited).toMatchObject({ providerId: "codex-alt", home: "/defaults/codex" });
  });

  it("expands a tilde home to an absolute path", () => {
    const [, , expanded] = resolveTranscriptHomes({
      defaultHomes,
      overrides: { "codex-tilde": { extends: "codex", env: { CODEX_HOME: "~/codex-alt" } } },
    });
    expect(expanded?.home).toBe(path.join(process.env["HOME"] ?? os.homedir(), "codex-alt"));
  });

  it("skips providers that resolve to a kind without token transcripts", () => {
    const homes = resolveTranscriptHomes({
      defaultHomes,
      overrides: { "copilot-work": { extends: "copilot" }, "loop-a": { extends: "loop-a" } },
    });
    expect(homes.map((home) => home.providerId)).toEqual(["claude", "codex"]);
  });
});

describe("dedupeTranscriptHomes", () => {
  it("keeps the first home when several resolve to one real directory", async () => {
    const real = path.join(root, "codex", "sessions");
    await fs.mkdir(real, { recursive: true });
    const link = path.join(root, "codex-link");
    await fs.symlink(path.join(root, "codex"), link, "dir");

    const homes = resolveTranscriptHomes({
      defaultHomes: { claude: path.join(root, "claude"), codex: path.join(root, "codex") },
      overrides: {
        "codex-same": { extends: "codex", env: { CODEX_HOME: path.join(root, "codex") } },
        "codex-linked": { extends: "codex", env: { CODEX_HOME: link } },
      },
    });
    const deduped = await dedupeTranscriptHomes(homes);
    expect(deduped.map((home) => home.providerId)).toEqual(["claude", "codex"]);
  });

  it("deduplicates a home whose transcript directory does not exist yet", async () => {
    const link = path.join(root, "codex-link");
    await fs.mkdir(path.join(root, "codex"), { recursive: true });
    await fs.symlink(path.join(root, "codex"), link, "dir");

    const deduped = await dedupeTranscriptHomes(
      resolveTranscriptHomes({
        defaultHomes: { claude: path.join(root, "claude"), codex: path.join(root, "codex") },
        overrides: { "codex-linked": { extends: "codex", env: { CODEX_HOME: link } } },
      }),
    );
    expect(deduped.map((home) => home.providerId)).toEqual(["claude", "codex"]);
  });
});

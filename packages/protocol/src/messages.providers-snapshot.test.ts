import { describe, expect, test } from "vitest";
import {
  GetProvidersSnapshotResponseMessageSchema,
  ProviderSnapshotEntrySchema,
  ProvidersSnapshotUpdateMessageSchema,
} from "./messages.js";

describe("provider snapshot message schemas", () => {
  test("defaults missing provider snapshot entry enabled state to true", () => {
    const parsed = ProviderSnapshotEntrySchema.parse({
      provider: "codex",
      status: "ready",
      label: "Codex",
    });

    expect(parsed.enabled).toBe(true);
  });

  test("preserves disabled provider snapshot entries", () => {
    const parsed = ProviderSnapshotEntrySchema.parse({
      provider: "claude",
      status: "unavailable",
      enabled: false,
      label: "Claude",
    });

    expect(parsed.enabled).toBe(false);
  });

  test("preserves enabled provider snapshot entries", () => {
    const parsed = ProviderSnapshotEntrySchema.parse({
      provider: "opencode",
      status: "loading",
      enabled: true,
      label: "OpenCode",
    });

    expect(parsed.enabled).toBe(true);
  });

  test("preserves provider snapshot entry source", () => {
    const parsed = ProviderSnapshotEntrySchema.parse({
      provider: "gemini",
      status: "ready",
      enabled: true,
      source: "custom",
      label: "Gemini",
    });

    expect(parsed.source).toBe("custom");
  });

  test("carries the account declaration that makes a provider addable twice", () => {
    const parsed = ProviderSnapshotEntrySchema.parse({
      provider: "claude",
      status: "ready",
      label: "Claude",
      accounts: { envVar: "CLAUDE_CONFIG_DIR", directoryExample: "/home/you/.claude-work" },
    });

    expect(parsed.accounts).toEqual({
      envVar: "CLAUDE_CONFIG_DIR",
      directoryExample: "/home/you/.claude-work",
    });
  });

  test("treats a daemon that never mentions accounts as offering none", () => {
    const parsed = ProviderSnapshotEntrySchema.parse({
      provider: "claude",
      status: "ready",
      label: "Claude",
    });

    expect(parsed.accounts).toBeUndefined();
  });

  test("defaults missing enabled state in providers snapshot response entries", () => {
    const parsed = GetProvidersSnapshotResponseMessageSchema.parse({
      type: "get_providers_snapshot_response",
      payload: {
        entries: [
          {
            provider: "codex",
            status: "ready",
            label: "Codex",
          },
          {
            provider: "claude",
            status: "unavailable",
            enabled: false,
            label: "Claude",
          },
        ],
        generatedAt: "2026-04-24T00:00:00.000Z",
        requestId: "req-providers",
      },
    });

    expect(parsed.payload.entries.map((entry) => entry.enabled)).toEqual([true, false]);
  });

  test("defaults missing enabled state in providers snapshot update entries", () => {
    const parsed = ProvidersSnapshotUpdateMessageSchema.parse({
      type: "providers_snapshot_update",
      payload: {
        cwd: "/tmp/repo",
        entries: [
          {
            provider: "codex",
            status: "ready",
            label: "Codex",
          },
        ],
        generatedAt: "2026-04-24T00:00:00.000Z",
      },
    });

    expect(parsed.payload.entries[0]?.enabled).toBe(true);
  });
});

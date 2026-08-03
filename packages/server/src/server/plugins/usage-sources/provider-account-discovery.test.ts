import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pino from "pino";
import { expect, test } from "vitest";
import { DaemonConfigStore } from "../../daemon-config-store.js";
import { PluginService } from "../index.js";
import { BuiltinPluginLoader } from "../builtin/index.js";

test.each(["codex-usage-source", "unrelated-plugin"])(
  "passes provider credentials only to the owning built-in plugin: %s",
  async (pluginId) => {
    const directory = mkdtempSync(join(tmpdir(), "paseo-account-discovery-"));
    try {
      const store = new DaemonConfigStore(directory, {
        mcp: { injectIntoAgents: false },
        browserTools: { enabled: false },
        providers: {
          "codex-work": { extends: "codex", label: "Work", env: { CODEX_HOME: "/old" } },
        },
        metadataGeneration: { providers: [] },
        autoArchiveAfterMerge: false,
        enableTerminalAgentHooks: false,
        appendSystemPrompt: "",
      });
      const fetched: unknown[] = [];
      type Runtime = NonNullable<
        NonNullable<ConstructorParameters<typeof PluginService>[3]>["runtime"]
      >;
      const runtime = {
        subscribe: () => () => {},
        catalog: () => [],
        startBuiltinPlugin: async () => {},
        getProviderRegistrations: () => [],
        getUsageSourceRegistrations: () => [{ id: "codex", label: "Codex" }],
        discoverUsage: async () => [{ key: "default", input: { default: true } }],
        fetchUsage: async (_plugin: string, _source: string, input: unknown) => {
          fetched.push(input);
          return { status: "available", windows: [] };
        },
      } as unknown as Runtime;
      const service = new PluginService(pino({ level: "silent" }), store, "0.10.0", {
        runtime,
        builtinPlugins: new BuiltinPluginLoader(directory, [pluginId]),
      });
      await service.start();
      const first = await service.listUsageReports();
      if (pluginId === "unrelated-plugin") {
        expect(first).toHaveLength(1);
        expect(fetched).toEqual([{ default: true }]);
        return;
      }
      expect(first.map((entry) => [entry.id, entry.account.label])).toEqual([
        ["codex:default", undefined],
        ["codex:provider.codex-work", "Work"],
      ]);
      expect(fetched).toContainEqual({ route: { store: "codex", path: "/old/auth.json" } });
      store.patch({
        providers: {
          "codex-work": { extends: "codex", label: "Renamed", env: { CODEX_HOME: "/new" } },
        },
      });
      await service.listUsageReports({ reportIds: ["codex:provider.codex-work"] });
      expect(fetched.at(-1)).toEqual({ route: { store: "codex", path: "/new/auth.json" } });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  },
);

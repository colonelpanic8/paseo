import { addLocalDaemonOptions } from "../../utils/command-options.js";
import { Command } from "commander";
import {
  readDaemonInstance,
  readPersistedConfig,
  getPersistedConfigValue,
  editPersistedConfig,
} from "@getpaseo/server";
import { connectToDaemon } from "../../utils/client.js";
import { localDaemonCommand } from "../../utils/daemon-target.js";
import { withOutput, type CommandOptions } from "../../output/index.js";

function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      /password|(?:api|private|access)[_-]?key|token|secret|authorization/i.test(key)
        ? "[redacted]"
        : redact(item),
    ]),
  );
}

function result(data: Record<string, unknown>) {
  return {
    type: "single" as const,
    data,
    schema: {
      idField: () => "configuration",
      columns: [],
      renderHuman: () => JSON.stringify(data, null, 2),
    },
  };
}

function instanceTargetOf(options: CommandOptions) {
  if (options.daemonTarget.kind !== "instance")
    throw new Error("Configuration edits require --home");
  return options.daemonTarget;
}

async function applySaved(
  target: Extract<CommandOptions["daemonTarget"], { kind: "instance" }>,
  options: CommandOptions,
) {
  const nextCommand = localDaemonCommand("start", target);
  const instance = await readDaemonInstance(target.home);
  if (!instance?.listen)
    return result({
      action: "saved",
      applied: false,
      message: "Saved; not applied to a running daemon",
      nextCommand,
    });
  let client;
  try {
    client = await connectToDaemon({ target: options.daemonTarget, timeout: 1_500 });
  } catch {
    return result({
      action: "saved",
      applied: false,
      message: "Saved; not applied to a running daemon",
      nextCommand: localDaemonCommand("reload", target),
    });
  }
  try {
    const reload = await client.reloadDaemonConfig();
    return result({ action: "saved", ...reload });
  } catch (error) {
    throw { code: "CONFIG_SAVED_RELOAD_FAILED", message: `Saved; reload failed: ${String(error)}` };
  } finally {
    await client.close();
  }
}

export function daemonConfigCommand(): Command {
  const config = new Command("config").description(
    "Read or edit persistent local configuration (local operation)",
  );
  addLocalDaemonOptions(config.command("get [path]")).action(
    withOutput(async (field: string | undefined, options: CommandOptions, _command: Command) => {
      const target = instanceTargetOf(options);
      const persisted = readPersistedConfig(target.home, {}, target.paths);
      const value = field ? getPersistedConfigValue(persisted, field) : persisted;
      return result({
        source: "configured",
        path: field ?? null,
        set: value !== undefined,
        value:
          field && /password|(?:api|private|access)[_-]?key|token|secret|authorization/i.test(field)
            ? "[redacted]"
            : redact(value),
      });
    }),
  );
  addLocalDaemonOptions(config.command("set <path> <value>"))
    .option("--string", "Interpret value literally as a string")
    .action(
      withOutput(async (field: string, raw: string, options: CommandOptions, _command: Command) => {
        let value: unknown = raw;
        if (!options.string) {
          try {
            value = JSON.parse(raw);
          } catch {
            /* Unquoted input is a string. */
          }
        }
        const target = instanceTargetOf(options);
        editPersistedConfig(target.home, field, { value }, target.paths);
        return applySaved(target, options);
      }),
    );
  addLocalDaemonOptions(config.command("unset <path>")).action(
    withOutput(async (field: string, options: CommandOptions, _command: Command) => {
      const target = instanceTargetOf(options);
      editPersistedConfig(target.home, field, { unset: true }, target.paths);
      return applySaved(target, options);
    }),
  );
  return config;
}

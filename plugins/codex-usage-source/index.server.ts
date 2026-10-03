import type { PluginServerContext } from "@getpaseo/plugin/server";
import { consumeBankedReset } from "./server/banked-resets.js";
import { consumeBankedResetRpc } from "./shared/banked-resets.js";
import { inputSchema } from "./shared/input.js";
import { discover, fetchUsage } from "./server/usage.js";

export default function contribute(server: PluginServerContext) {
  server.handle(consumeBankedResetRpc, (input) => consumeBankedReset(input));
  server.registerUsageSource({
    id: "codex",
    label: "Codex",
    icon: "icon.svg",
    input: inputSchema,
    discover: () => discover(),
    fetch: fetchUsage,
  });
  return () => {};
}

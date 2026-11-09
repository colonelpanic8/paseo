import type { ProviderSnapshotEntry } from "@getpaseo/protocol/agent-types";
import { createStore } from "zustand/vanilla";

export const providerSnapshotIcons = createStore<ReadonlyMap<string, ReadonlyMap<string, string>>>(
  () => new Map(),
);

export const providerSnapshotIconAliases = createStore<
  ReadonlyMap<string, ReadonlyMap<string, string>>
>(() => new Map());

export function replaceProviderSnapshotIcons(
  serverId: string,
  entries: readonly Pick<ProviderSnapshotEntry, "provider" | "iconSvg" | "baseProviderId">[],
): void {
  const icons = new Map<string, string>();
  const aliases = new Map<string, string>();
  for (const entry of entries) {
    if (entry.baseProviderId) aliases.set(entry.provider, entry.baseProviderId);
    if (entry.iconSvg) icons.set(entry.provider, entry.iconSvg);
  }
  providerSnapshotIconAliases.setState(
    (previous) => new Map(previous).set(serverId, aliases),
    true,
  );
  providerSnapshotIcons.setState((previous) => new Map(previous).set(serverId, icons), true);
}

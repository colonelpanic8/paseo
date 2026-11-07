import {
  filterAndRankModelRows,
  getAllProviderModelRows,
  getProviderModelRows,
  type ProviderSelectionModelRow,
  type ProviderSelectorProvider,
} from "@/provider-selection/provider-selection";

export type ModelBrowserHeadingStatus = "loading" | "error";

export type ModelBrowserListItem =
  | {
      kind: "heading";
      key: string;
      label: string;
      status?: ModelBrowserHeadingStatus;
      providerId: string;
    }
  | {
      kind: "model";
      key: string;
      row: ProviderSelectionModelRow;
      showProvider: boolean;
    };

export function countAllModels(providers: ProviderSelectorProvider[]): number {
  return getAllProviderModelRows(providers).length;
}

function toModelItem(row: ProviderSelectionModelRow, showProvider: boolean): ModelBrowserListItem {
  return { kind: "model", key: `model:${row.favoriteKey}`, row, showProvider };
}

function resolveHeadingStatus(
  provider: ProviderSelectorProvider,
): ModelBrowserHeadingStatus | undefined {
  if (provider.modelSelection.kind === "loading") return "loading";
  if (provider.modelSelection.kind === "error") return "error";
  return undefined;
}

export function buildAllModelsListItems({
  providers,
  normalizedQuery,
}: {
  providers: ProviderSelectorProvider[];
  normalizedQuery: string;
}): ModelBrowserListItem[] {
  if (normalizedQuery) {
    return filterAndRankModelRows(getAllProviderModelRows(providers), normalizedQuery).map((row) =>
      toModelItem(row, true),
    );
  }

  const items: ModelBrowserListItem[] = [];
  for (const provider of providers) {
    const status = resolveHeadingStatus(provider);
    const rows = getProviderModelRows(provider);
    if (!status && rows.length === 0) continue;
    items.push({
      kind: "heading",
      key: `heading:provider:${provider.id}`,
      label: provider.label,
      providerId: provider.id,
      ...(status ? { status } : {}),
    });
    for (const row of rows) {
      items.push(toModelItem(row, false));
    }
  }
  return items;
}

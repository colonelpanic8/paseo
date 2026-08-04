import { useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { layeredSettingsStorage } from "@/storage/settings-seed";

const STORAGE_KEY = "@paseo:keyboard-shortcut-overrides";
const QUERY_KEY = ["keyboard-shortcut-overrides"];

const EMPTY_OVERRIDES: Record<string, string> = {};

export interface UseKeyboardShortcutOverridesReturn {
  overrides: Record<string, string>;
  isLoading: boolean;
  setOverride: (bindingId: string, comboString: string) => Promise<void>;
  removeOverride: (bindingId: string) => Promise<void>;
  resetAll: () => Promise<void>;
  hasOverrides: boolean;
}

export function useKeyboardShortcutOverrides(): UseKeyboardShortcutOverridesReturn {
  const queryClient = useQueryClient();
  const { data, isPending } = useQuery({
    queryKey: QUERY_KEY,
    queryFn: loadOverridesFromStorage,
    staleTime: Infinity,
    gcTime: Infinity,
  });

  // Persisting can fail when a seed layer owns the binding, so the optimistic cache write is
  // rolled back before the error reaches the caller.
  const persist = useCallback(
    async (prev: Record<string, string>, next: Record<string, string>) => {
      queryClient.setQueryData<Record<string, string>>(QUERY_KEY, next);
      try {
        await layeredSettingsStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch (err) {
        queryClient.setQueryData<Record<string, string>>(QUERY_KEY, prev);
        throw err;
      }
    },
    [queryClient],
  );

  const setOverride = useCallback(
    async (bindingId: string, comboString: string) => {
      const prev = queryClient.getQueryData<Record<string, string>>(QUERY_KEY) ?? EMPTY_OVERRIDES;
      await persist(prev, { ...prev, [bindingId]: comboString });
    },
    [persist, queryClient],
  );

  const removeOverride = useCallback(
    async (bindingId: string) => {
      const prev = queryClient.getQueryData<Record<string, string>>(QUERY_KEY) ?? EMPTY_OVERRIDES;
      const { [bindingId]: _, ...next } = prev;
      await persist(prev, next);
    },
    [persist, queryClient],
  );

  const resetAll = useCallback(async () => {
    const prev = queryClient.getQueryData<Record<string, string>>(QUERY_KEY) ?? EMPTY_OVERRIDES;
    queryClient.setQueryData<Record<string, string>>(QUERY_KEY, EMPTY_OVERRIDES);
    try {
      await layeredSettingsStorage.removeItem(STORAGE_KEY);
    } catch (err) {
      queryClient.setQueryData<Record<string, string>>(QUERY_KEY, prev);
      throw err;
    }
  }, [queryClient]);

  const overrides = data ?? EMPTY_OVERRIDES;

  return {
    overrides,
    isLoading: isPending,
    setOverride,
    removeOverride,
    resetAll,
    hasOverrides: Object.keys(overrides).length > 0,
  };
}

async function loadOverridesFromStorage(): Promise<Record<string, string>> {
  try {
    const stored = await layeredSettingsStorage.getItem(STORAGE_KEY);
    if (stored) {
      return JSON.parse(stored) as Record<string, string>;
    }
  } catch (err) {
    console.error("[KeyboardShortcutOverrides] Failed to load overrides:", err);
  }
  return EMPTY_OVERRIDES;
}

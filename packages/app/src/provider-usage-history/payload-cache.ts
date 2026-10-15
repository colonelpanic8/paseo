import AsyncStorage from "@react-native-async-storage/async-storage";
import { z } from "zod";
import { ProviderUsageHistoryReadResponseMessageSchema } from "@getpaseo/protocol/messages";
import type { ProviderUsageHistoryPayload } from "./types";
import type { ProviderUsageHistoryWindow } from "./window";

/**
 * Remembers the last payload each host reported, so reopening the page draws the numbers it drew
 * last time instead of a spinner. It is never an answer on its own: the page refetches on every
 * mount and replaces what it reads here, so a cached payload is at most one scan out of date and
 * there is nothing to invalidate by hand.
 */
const KEY_PREFIX = "@paseo/usage-history/v1";

const StoredUsageHistorySchema = z.object({
  payload: ProviderUsageHistoryReadResponseMessageSchema.shape.payload,
});

const CacheKeySchema = z.tuple([z.string(), z.string(), z.string(), z.string()]);

function cacheKey(serverId: string, window: ProviderUsageHistoryWindow): string {
  return `${KEY_PREFIX}:${JSON.stringify([serverId, window.timeZone, window.sinceDay, window.untilDay])}`;
}

/** Every window the page asks for ends today, so an older end day can never be read again. */
function cachedUntilDay(key: string): string | null {
  const parsed = CacheKeySchema.safeParse(JSON.parse(key.slice(KEY_PREFIX.length + 1)));
  return parsed.success ? parsed.data[3] : null;
}

export async function readCachedUsageHistory(
  serverId: string,
  window: ProviderUsageHistoryWindow,
): Promise<ProviderUsageHistoryPayload | null> {
  const stored = await AsyncStorage.getItem(cacheKey(serverId, window));
  if (stored === null) return null;
  let document: unknown;
  try {
    document = JSON.parse(stored);
  } catch {
    // A half-written entry is a cache miss; the page is about to overwrite it anyway.
    return null;
  }
  const parsed = StoredUsageHistorySchema.safeParse(document);
  return parsed.success ? parsed.data.payload : null;
}

export async function writeCachedUsageHistory(
  serverId: string,
  window: ProviderUsageHistoryWindow,
  payload: ProviderUsageHistoryPayload,
): Promise<void> {
  await AsyncStorage.setItem(cacheKey(serverId, window), JSON.stringify({ payload }));
  const keys = await AsyncStorage.getAllKeys();
  const expired = keys.filter((key) => {
    if (!key.startsWith(`${KEY_PREFIX}:`)) return false;
    const untilDay = cachedUntilDay(key);
    return untilDay === null || untilDay < window.untilDay;
  });
  if (expired.length > 0) await AsyncStorage.multiRemove(expired);
}

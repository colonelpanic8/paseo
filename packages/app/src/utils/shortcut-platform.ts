import { Platform } from "react-native";
import { getIsElectronRuntimeMac } from "@/constants/layout";
import type { ShortcutOs } from "@/utils/format-shortcut";
import { isNative } from "@/constants/platform";
import { isMacUserAgent } from "@/utils/mac-user-agent";
import {
  getShortcutModPreference,
  useShortcutModStore,
  type ShortcutModPreference,
} from "@/stores/shortcut-mod-store";

function getPlatformShortcutOs(): ShortcutOs {
  if (isNative) {
    return Platform.OS === "ios" ? "mac" : "non-mac";
  }
  if (getIsElectronRuntimeMac()) return "mac";
  return isMacUserAgent() ? "mac" : "non-mac";
}

function resolveShortcutOs(preference: ShortcutModPreference): ShortcutOs {
  if (preference === "cmd") return "mac";
  if (preference === "ctrl") return "non-mac";
  return getPlatformShortcutOs();
}

export function getShortcutOs(): ShortcutOs {
  return resolveShortcutOs(getShortcutModPreference());
}

/** getShortcutOs that re-renders when the modifier-key preference changes. */
export function useShortcutOs(): ShortcutOs {
  return resolveShortcutOs(useShortcutModStore((state) => state.preference));
}

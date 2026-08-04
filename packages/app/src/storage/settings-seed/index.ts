import AsyncStorage from "@react-native-async-storage/async-storage";
import { createLayeredSettingsStorage } from "./layered-storage";
import { loadSettingsSeed } from "./seed-source";

/**
 * The storage every seedable preference store writes through: a read-only seed layer under the
 * machine-local AsyncStorage layer. Saves persist only what differs from the seed.
 */
export const layeredSettingsStorage = createLayeredSettingsStorage({
  base: AsyncStorage,
  loadSeed: loadSettingsSeed,
});

export { createLayeredSettingsStorage, SeedShadowedError } from "./layered-storage";
export type { LayeredSettingsStorageDeps, SettingsKeyValueStorage } from "./layered-storage";
export { findLayerableSetting, LAYERABLE_SETTINGS } from "./registry";
export type { LayerableSetting, SeedValueKind } from "./registry";
export { loadSettingsSeed } from "./seed-source";
export type { SettingsSeed } from "./types";

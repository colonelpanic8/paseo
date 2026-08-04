import { layeredSettingsStorage } from "@/storage/settings-seed";
import type { FormPreferences } from "./preferences";

export const CREATE_AGENT_PREFERENCES_STORAGE_KEY = "@paseo:create-agent-preferences";

export interface CreateAgentPreferenceStorage {
  read(): Promise<unknown>;
  write(preferences: FormPreferences): Promise<void>;
}

export class AsyncStorageCreateAgentPreferenceStorage implements CreateAgentPreferenceStorage {
  async read(): Promise<unknown> {
    const stored = await layeredSettingsStorage.getItem(CREATE_AGENT_PREFERENCES_STORAGE_KEY);
    if (!stored) {
      return null;
    }

    try {
      return JSON.parse(stored);
    } catch {
      return null;
    }
  }

  async write(preferences: FormPreferences): Promise<void> {
    await layeredSettingsStorage.setItem(
      CREATE_AGENT_PREFERENCES_STORAGE_KEY,
      JSON.stringify(preferences),
    );
  }
}

import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

export interface DispatchAgentTarget {
  serverId: string;
  agentId: string;
}

interface DispatchSettingsState {
  target: DispatchAgentTarget | null;
  setTarget: (target: DispatchAgentTarget | null) => void;
}

/** The phone-owned agent that receives one-shot prompts dictated on the watch. */
export const useDispatchSettingsStore = create<DispatchSettingsState>()(
  persist(
    (set) => ({
      target: null,
      setTarget: (target) => set({ target }),
    }),
    {
      name: "paseo-dispatch-settings",
      storage: createJSONStorage(() => AsyncStorage),
    },
  ),
);

/** Read outside React for the Wear command executor and projection. */
export function getDispatchAgentTarget(): DispatchAgentTarget | null {
  return useDispatchSettingsStore.getState().target;
}

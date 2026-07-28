import { create } from "zustand";

export interface CustomSnoozeRequest {
  id: number;
  serverId: string;
  agentId: string;
}

interface CustomSnoozeStore {
  request: CustomSnoozeRequest | null;
  open: (serverId: string, agentId: string) => void;
  close: () => void;
}

let nextRequestId = 1;

export const useCustomSnoozeStore = create<CustomSnoozeStore>((set) => ({
  request: null,
  open: (serverId, agentId) => {
    set({ request: { id: nextRequestId++, serverId, agentId } });
  },
  close: () => set({ request: null }),
}));

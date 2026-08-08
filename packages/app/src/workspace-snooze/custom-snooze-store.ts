import { create } from "zustand";

export interface CustomSnoozeRequest {
  id: number;
  serverId: string;
  workspaceId: string;
}

interface CustomSnoozeStore {
  request: CustomSnoozeRequest | null;
  open: (serverId: string, workspaceId: string) => void;
  close: () => void;
}

let nextRequestId = 1;

export const useCustomSnoozeStore = create<CustomSnoozeStore>((set) => ({
  request: null,
  open: (serverId, workspaceId) => {
    set({ request: { id: nextRequestId++, serverId, workspaceId } });
  },
  close: () => set({ request: null }),
}));

/** @vitest-environment jsdom */
import React from "react";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import type { VoiceProfile } from "@getpaseo/protocol/voice-profiles";
import { useVoiceProfiles } from "./voice-profile-queries";

const connection = vi.hoisted(() => ({
  sessions: { host: { client: null as DaemonClient | null } },
}));
vi.mock("@/stores/session-store", () => ({
  useSessionStore: (selector: (value: typeof connection) => unknown) => selector(connection),
}));
vi.mock("./voice-selection-store", () => ({ useVoiceSelectionStore: () => () => {} }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
afterEach(cleanup);

it("does not display a prior connection's private profiles while a replacement connection loads", async () => {
  const firstList = [{ id: `prf_${"a".repeat(32)}`, name: "Private profile" }] as VoiceProfile[];
  connection.sessions.host.client = {
    listVoiceProfiles: async () => ({ profiles: firstList, defaultProfileId: null }),
  } as unknown as DaemonClient;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }
  const hook = renderHook(() => useVoiceProfiles("host"), { wrapper: Wrapper });
  await waitFor(() => expect(hook.result.current.profiles).toEqual(firstList));
  let resolve!: (value: { profiles: VoiceProfile[]; defaultProfileId: string | null }) => void;
  const loading = new Promise<{ profiles: VoiceProfile[]; defaultProfileId: string | null }>(
    (done) => {
      resolve = done;
    },
  );
  connection.sessions.host.client = {
    listVoiceProfiles: () => loading,
  } as unknown as DaemonClient;
  hook.rerender();
  expect(hook.result.current.profiles).toEqual([]);
  resolve({ profiles: [], defaultProfileId: "cfg_work" });
  await waitFor(() => expect(hook.result.current.isLoading).toBe(false));
  expect(hook.result.current.defaultProfileId).toBe("cfg_work");
  client.clear();
});

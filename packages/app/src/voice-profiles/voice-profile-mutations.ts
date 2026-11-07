import { useCallback } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type {
  VoiceProfile,
  VoiceProfileConfiguration,
  VoiceThread,
} from "@getpaseo/protocol/voice-profiles";
import { requireVoiceClient, voiceProfilesQueryBaseKey } from "./voice-profile-queries";
import { useVoiceSelectionStore } from "./voice-selection-store";

export interface SaveVoiceProfileInput {
  profileId?: string;
  expectedRevision?: number;
  name: string;
  configuration: VoiceProfileConfiguration;
}

export interface UpdateVoiceThreadInput {
  threadId: string;
  expectedRevision: number;
  title: string;
}

export interface CompactVoiceThreadInput {
  threadId: string;
  expectedRevision: number;
  throughSeq: number;
  summary: string;
}

export interface UseVoiceProfileMutationsResult {
  saveProfile: (input: SaveVoiceProfileInput) => Promise<VoiceProfile>;
  deleteProfile: (profileId: string) => Promise<void>;
  updateThread: (input: UpdateVoiceThreadInput) => Promise<VoiceThread>;
  compactThread: (input: CompactVoiceThreadInput) => Promise<VoiceThread>;
  deleteThread: (threadId: string) => Promise<void>;
  isSaving: boolean;
  isDeleting: boolean;
}

/**
 * Every mutation invalidates the whole namespace for the host: profile lists,
 * thread lists, and history pages all derive from the same records, and the
 * daemon is the only authority on revisions.
 */
export function useVoiceProfileMutations({
  serverId,
}: {
  serverId: string;
}): UseVoiceProfileMutationsResult {
  const queryClient = useQueryClient();
  const { t } = useTranslation();
  const selectProfile = useVoiceSelectionStore((state) => state.selectProfile);
  const selectThread = useVoiceSelectionStore((state) => state.selectThread);

  const invalidate = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: voiceProfilesQueryBaseKey });
  }, [queryClient]);

  const client = useCallback(
    () => requireVoiceClient(serverId, t("common.errors.daemonClientUnavailable")),
    [serverId, t],
  );

  const saveProfileMutation = useMutation({
    mutationFn: async (input: SaveVoiceProfileInput) => await client().saveVoiceProfile(input),
    onSettled: invalidate,
  });
  const deleteProfileMutation = useMutation({
    mutationFn: async (profileId: string) => {
      await client().deleteVoiceProfile({ profileId });
    },
    onSuccess: (_result, profileId) => {
      // The launcher must not keep pointing at a record the daemon just removed.
      if (useVoiceSelectionStore.getState().profileByServerId[serverId] === profileId) {
        selectProfile(serverId, null);
      }
    },
    onSettled: invalidate,
  });
  const updateThreadMutation = useMutation({
    mutationFn: async (input: UpdateVoiceThreadInput) => await client().updateVoiceThread(input),
    onSettled: invalidate,
  });
  const compactThreadMutation = useMutation({
    mutationFn: async (input: CompactVoiceThreadInput) => await client().compactVoiceThread(input),
    onSettled: invalidate,
  });
  const deleteThreadMutation = useMutation({
    mutationFn: async (threadId: string) => {
      await client().deleteVoiceThread({ threadId });
    },
    onSuccess: (_result, threadId) => {
      if (useVoiceSelectionStore.getState().threadByServerId[serverId] === threadId) {
        selectThread(serverId, null);
      }
    },
    onSettled: invalidate,
  });

  return {
    saveProfile: saveProfileMutation.mutateAsync,
    deleteProfile: deleteProfileMutation.mutateAsync,
    updateThread: updateThreadMutation.mutateAsync,
    compactThread: compactThreadMutation.mutateAsync,
    deleteThread: deleteThreadMutation.mutateAsync,
    isSaving:
      saveProfileMutation.isPending ||
      updateThreadMutation.isPending ||
      compactThreadMutation.isPending,
    isDeleting: deleteProfileMutation.isPending || deleteThreadMutation.isPending,
  };
}

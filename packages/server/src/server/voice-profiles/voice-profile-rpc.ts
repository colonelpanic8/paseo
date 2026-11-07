import type { VoiceProfileRequest, VoiceProfileResponse } from "@getpaseo/protocol/voice-profiles";
import { VoiceProfileStoreError, type VoiceProfileStore } from "./voice-profile-store.js";
import { VoiceThreadStoreError, type VoiceThreadStore } from "./voice-thread-store.js";

/**
 * Maps one profile or thread RPC onto the stores for a principal the daemon
 * already trusts. The principal comes from session admission, never from the
 * wire, and every reply is a source-only response so private data never
 * broadcasts.
 */
export class VoiceProfileRequestError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "VoiceProfileRequestError";
  }
}

export interface VoiceProfileRpcContext {
  profiles: VoiceProfileStore | null;
  threads: VoiceThreadStore | null;
  principalId: string | null;
}

export async function handleVoiceProfileRequest(
  context: VoiceProfileRpcContext,
  request: VoiceProfileRequest,
): Promise<VoiceProfileResponse> {
  const { profiles, threads, principalId } = context;
  if (!profiles || !threads) {
    throw new VoiceProfileRequestError("unsupported", "This daemon does not support profiles.");
  }
  if (!principalId) {
    throw new VoiceProfileRequestError("unauthorized", "Profile ownership is unavailable.");
  }
  try {
    return await dispatch(profiles, threads, principalId, request);
  } catch (error) {
    if (error instanceof VoiceProfileStoreError || error instanceof VoiceThreadStoreError) {
      throw new VoiceProfileRequestError(error.code, error.message);
    }
    throw error;
  }
}

async function dispatch(
  profiles: VoiceProfileStore,
  threads: VoiceThreadStore,
  principalId: string,
  request: VoiceProfileRequest,
): Promise<VoiceProfileResponse> {
  const { requestId } = request;
  switch (request.type) {
    case "voice.profile.list.request":
      return {
        type: "voice.profile.list.response",
        payload: {
          requestId,
          profiles: await profiles.list(principalId),
          defaultProfileId: profiles.defaultProfileId,
        },
      };
    case "voice.profile.save.request": {
      const { type: _type, requestId: _requestId, ...input } = request;
      return {
        type: "voice.profile.save.response",
        payload: { requestId, profile: await profiles.save(principalId, input) },
      };
    }
    case "voice.profile.delete.request":
      await profiles.delete(principalId, request.profileId);
      return { type: "voice.profile.delete.response", payload: { requestId } };
    case "voice.thread.list.request":
      return {
        type: "voice.thread.list.response",
        payload: { requestId, threads: await threads.list(principalId) },
      };
    case "voice.thread.get.request": {
      const page = await threads.get(principalId, request.threadId, {
        ...(request.beforeSeq !== undefined ? { beforeSeq: request.beforeSeq } : {}),
        ...(request.limit !== undefined ? { limit: request.limit } : {}),
      });
      return { type: "voice.thread.get.response", payload: { requestId, ...page } };
    }
    case "voice.thread.update.request": {
      const { type: _type, requestId: _requestId, ...input } = request;
      return {
        type: "voice.thread.update.response",
        payload: { requestId, thread: await threads.update(principalId, input) },
      };
    }
    case "voice.thread.compact.request": {
      const { type: _type, requestId: _requestId, ...input } = request;
      return {
        type: "voice.thread.compact.response",
        payload: { requestId, thread: await threads.compact(principalId, input) },
      };
    }
    case "voice.thread.delete.request":
      await threads.delete(principalId, request.threadId);
      return { type: "voice.thread.delete.response", payload: { requestId } };
  }
}

import { z } from "zod";

/**
 * Live Voice profiles and threads.
 *
 * A profile is configuration: how the assistant behaves on a call. A thread is
 * memory: the history one line of calls accumulates. Starting a call names a
 * profile and either continues a thread or opens a new one under it, so the
 * user never creates a thread by hand.
 *
 * Profiles come from two places. User profiles live in the daemon's store and
 * are edited over these RPCs. Config profiles are declared in the daemon's
 * config.json and are read-only here; their ids carry the `cfg_` prefix so a
 * client can tell them apart without a second lookup.
 */
export const VoiceProfileIdSchema = z
  .string()
  .regex(/^(?:prf_[a-f0-9]{32}|cfg_[a-z0-9]+(?:[._-][a-z0-9]+)*)$/);
export const VoiceThreadIdSchema = z.string().regex(/^thr_[a-f0-9]{32}$/);
const NameSchema = z.string().min(1).max(120);
const RevisionSchema = z.number().int().positive();
const SequenceSchema = z.number().int().nonnegative();

export const VOICE_THREAD_TITLE_MAX_LENGTH = 200;

export const VoiceProfileConfigurationSchema = z.object({
  instructions: z.string().max(1000),
  context: z.string().max(8000),
  /** Absolute or ~-rooted paths the daemon reads at call start. */
  files: z.array(z.string().min(1).max(1024)).max(16),
  voice: z.string().max(120).nullable(),
  backendModel: z.string().max(200).nullable(),
  backendThinkingOptionId: z.string().max(80).nullable(),
});
export type VoiceProfileConfiguration = z.infer<typeof VoiceProfileConfigurationSchema>;

export const DEFAULT_VOICE_PROFILE_CONFIGURATION: VoiceProfileConfiguration = {
  instructions: "",
  context: "",
  files: [],
  voice: null,
  backendModel: null,
  backendThinkingOptionId: null,
};

export const VoiceProfileSchema = z.object({
  id: VoiceProfileIdSchema,
  name: NameSchema,
  source: z.enum(["user", "config"]),
  configuration: VoiceProfileConfigurationSchema,
  revision: RevisionSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type VoiceProfile = z.infer<typeof VoiceProfileSchema>;

export const VoiceThreadSchema = z.object({
  id: VoiceThreadIdSchema,
  /** Null once the profile is deleted; the thread keeps its history. */
  profileId: VoiceProfileIdSchema.nullable(),
  /** Empty until the first user utterance names it or the user renames it. */
  title: z.string().max(VOICE_THREAD_TITLE_MAX_LENGTH),
  revision: RevisionSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
  summary: z.string().max(8000),
  summaryThroughSeq: SequenceSchema,
  lastSeq: SequenceSchema,
});
export type VoiceThread = z.infer<typeof VoiceThreadSchema>;

const HistoryBase = {
  seq: RevisionSchema,
  callId: z.string(),
  createdAt: z.string(),
};
export const VoiceThreadHistoryEntrySchema = z.discriminatedUnion("kind", [
  z.object({
    ...HistoryBase,
    kind: z.literal("transcript"),
    role: z.enum(["user", "assistant"]),
    text: z.string().max(16_000),
  }),
  z.object({ ...HistoryBase, kind: z.literal("call_started") }),
  z.object({ ...HistoryBase, kind: z.literal("call_ended"), cause: z.string() }),
  z.object({
    ...HistoryBase,
    kind: z.literal("delegation"),
    requestId: z.string(),
    description: z.string().max(1000),
    ok: z.boolean(),
    errorCode: z.string().optional(),
  }),
]);
export type VoiceThreadHistoryEntry = z.infer<typeof VoiceThreadHistoryEntrySchema>;

const RequestFields = { requestId: z.string() };

export const VoiceProfileListRequestSchema = z.object({
  ...RequestFields,
  type: z.literal("voice.profile.list.request"),
});
export const VoiceProfileSaveRequestSchema = z.object({
  ...RequestFields,
  type: z.literal("voice.profile.save.request"),
  /** Absent creates a profile; present with `expectedRevision` edits one. */
  profileId: VoiceProfileIdSchema.optional(),
  expectedRevision: RevisionSchema.optional(),
  name: NameSchema,
  configuration: VoiceProfileConfigurationSchema,
});
export const VoiceProfileDeleteRequestSchema = z.object({
  ...RequestFields,
  type: z.literal("voice.profile.delete.request"),
  profileId: VoiceProfileIdSchema,
});
export const VoiceThreadListRequestSchema = z.object({
  ...RequestFields,
  type: z.literal("voice.thread.list.request"),
});
export const VoiceThreadGetRequestSchema = z.object({
  ...RequestFields,
  type: z.literal("voice.thread.get.request"),
  threadId: VoiceThreadIdSchema,
  beforeSeq: SequenceSchema.optional(),
  limit: z.number().int().min(1).max(200).optional(),
});
export const VoiceThreadUpdateRequestSchema = z.object({
  ...RequestFields,
  type: z.literal("voice.thread.update.request"),
  threadId: VoiceThreadIdSchema,
  expectedRevision: RevisionSchema,
  title: z.string().max(VOICE_THREAD_TITLE_MAX_LENGTH),
});
export const VoiceThreadCompactRequestSchema = z.object({
  ...RequestFields,
  type: z.literal("voice.thread.compact.request"),
  threadId: VoiceThreadIdSchema,
  expectedRevision: RevisionSchema,
  throughSeq: SequenceSchema,
  summary: z.string().max(8000),
});
export const VoiceThreadDeleteRequestSchema = z.object({
  ...RequestFields,
  type: z.literal("voice.thread.delete.request"),
  threadId: VoiceThreadIdSchema,
});

function response<T extends string, S extends z.ZodRawShape>(type: T, shape: S) {
  return z.object({ type: z.literal(type), payload: z.object({ ...RequestFields, ...shape }) });
}

export const VoiceProfileListResponseSchema = response("voice.profile.list.response", {
  profiles: z.array(VoiceProfileSchema),
  /** The daemon's configured default, offered when the client has no selection. */
  defaultProfileId: VoiceProfileIdSchema.nullable(),
});
export const VoiceProfileSaveResponseSchema = response("voice.profile.save.response", {
  profile: VoiceProfileSchema,
});
export const VoiceProfileDeleteResponseSchema = response("voice.profile.delete.response", {});
export const VoiceThreadListResponseSchema = response("voice.thread.list.response", {
  threads: z.array(VoiceThreadSchema),
});
export const VoiceThreadGetResponseSchema = response("voice.thread.get.response", {
  thread: VoiceThreadSchema,
  history: z.array(VoiceThreadHistoryEntrySchema),
  hasMore: z.boolean(),
});
export const VoiceThreadUpdateResponseSchema = response("voice.thread.update.response", {
  thread: VoiceThreadSchema,
});
export const VoiceThreadCompactResponseSchema = response("voice.thread.compact.response", {
  thread: VoiceThreadSchema,
});
export const VoiceThreadDeleteResponseSchema = response("voice.thread.delete.response", {});

export const VOICE_PROFILE_REQUEST_SCHEMAS = [
  VoiceProfileListRequestSchema,
  VoiceProfileSaveRequestSchema,
  VoiceProfileDeleteRequestSchema,
  VoiceThreadListRequestSchema,
  VoiceThreadGetRequestSchema,
  VoiceThreadUpdateRequestSchema,
  VoiceThreadCompactRequestSchema,
  VoiceThreadDeleteRequestSchema,
] as const;
export const VOICE_PROFILE_RESPONSE_SCHEMAS = [
  VoiceProfileListResponseSchema,
  VoiceProfileSaveResponseSchema,
  VoiceProfileDeleteResponseSchema,
  VoiceThreadListResponseSchema,
  VoiceThreadGetResponseSchema,
  VoiceThreadUpdateResponseSchema,
  VoiceThreadCompactResponseSchema,
  VoiceThreadDeleteResponseSchema,
] as const;
export const VoiceProfileRequestSchema = z.discriminatedUnion(
  "type",
  VOICE_PROFILE_REQUEST_SCHEMAS,
);
export const VoiceProfileResponseSchema = z.discriminatedUnion(
  "type",
  VOICE_PROFILE_RESPONSE_SCHEMAS,
);
export type VoiceProfileRequest = z.infer<typeof VoiceProfileRequestSchema>;
export type VoiceProfileResponse = z.infer<typeof VoiceProfileResponseSchema>;

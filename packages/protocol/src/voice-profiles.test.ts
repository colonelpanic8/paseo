import { describe, expect, it } from "vitest";
import {
  DEFAULT_VOICE_PROFILE_CONFIGURATION,
  VoiceProfileIdSchema,
  VoiceProfileRequestSchema,
} from "./voice-profiles.js";
import {
  SessionInboundMessageSchema,
  ServerInfoStatusPayloadSchema,
  VoiceLiveStartRequestSchema,
} from "./messages.js";
import { validateWSOutboundMessage } from "./validation/ws-outbound.js";

describe("voice profile protocol", () => {
  it("keeps legacy voice start and server capabilities optional", () => {
    const start = VoiceLiveStartRequestSchema.parse({
      type: "voice.live.start.request",
      requestId: "old",
      negotiation: { kind: "webrtc_sdp", offerSdp: "offer" },
    });
    expect(start.profileId).toBeUndefined();
    expect(start.threadId).toBeUndefined();
    expect(
      ServerInfoStatusPayloadSchema.parse({ status: "server_info", serverId: "old", features: {} })
        .features?.voiceProfiles,
    ).toBeUndefined();
  });

  it("accepts config-declared and stored profile ids and nothing path-like", () => {
    expect(VoiceProfileIdSchema.safeParse(`prf_${"a".repeat(32)}`).success).toBe(true);
    expect(VoiceProfileIdSchema.safeParse("cfg_work").success).toBe(true);
    expect(VoiceProfileIdSchema.safeParse("cfg_life.v2-x").success).toBe(true);
    expect(VoiceProfileIdSchema.safeParse("../../secrets").success).toBe(false);
    expect(VoiceProfileIdSchema.safeParse("cfg_").success).toBe(false);
  });

  it("rejects unsafe record ids and invalid revision/checkpoint values", () => {
    expect(
      VoiceProfileRequestSchema.safeParse({
        type: "voice.thread.get.request",
        requestId: "get",
        threadId: "../../secrets",
      }).success,
    ).toBe(false);
    expect(
      VoiceProfileRequestSchema.safeParse({
        type: "voice.thread.compact.request",
        requestId: "edit",
        threadId: `thr_${"a".repeat(32)}`,
        expectedRevision: 0,
        throughSeq: -1,
        summary: "",
      }).success,
    ).toBe(false);
    expect(
      SessionInboundMessageSchema.safeParse({
        type: "voice.profile.save.request",
        requestId: "profile",
        name: "Work",
        configuration: DEFAULT_VOICE_PROFILE_CONFIGURATION,
      }).success,
    ).toBe(true);
  });

  it("validates paged history through the generated websocket validator", () => {
    const message = {
      type: "session",
      message: {
        type: "voice.thread.get.response",
        payload: {
          requestId: "get",
          thread: {
            id: `thr_${"a".repeat(32)}`,
            profileId: "cfg_work",
            title: "Ship the voice project",
            revision: 1,
            createdAt: "now",
            updatedAt: "now",
            summary: "",
            summaryThroughSeq: 0,
            lastSeq: 1,
          },
          history: [
            {
              kind: "delegation",
              seq: 1,
              createdAt: "now",
              callId: "call",
              requestId: "tool",
              description: "list_agents",
              ok: false,
              errorCode: "future_code",
            },
          ],
          hasMore: false,
        },
      },
    };
    expect(validateWSOutboundMessage(message).success).toBe(true);
    expect(
      validateWSOutboundMessage({
        ...message,
        message: {
          ...message.message,
          payload: {
            ...message.message.payload,
            history: [{ ...message.message.payload.history[0], ok: "false" }],
          },
        },
      }).success,
    ).toBe(false);
  });
});

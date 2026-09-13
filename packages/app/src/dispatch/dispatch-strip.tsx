import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, Text, View } from "react-native";
import Animated from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { StyleSheet } from "react-native-unistyles";
import { Button } from "@/components/ui/button";
import { isNative } from "@/constants/platform";
import type { DispatchLink } from "@/dispatch/dispatch-link";
import { useDispatchRequest } from "@/dispatch/dispatch-request";
import {
  createDispatchSilenceTracker,
  type DispatchSilenceTracker,
} from "@/dispatch/dispatch-silence";
import { useDictation } from "@/hooks/use-dictation";
import { useKeyboardShiftStyle } from "@/hooks/use-keyboard-shift-style";
import {
  createLiveVoiceCuePlayer,
  type LiveVoiceCuePlayer,
} from "@/live-voice/live-voice-cue-player";
import { getDispatchAgentTarget, type DispatchAgentTarget } from "@/stores/dispatch-settings-store";
import { useSessionStore } from "@/stores/session-store";
import { providerLabel } from "@/wear/wear-snapshot";

const TICK_MS = 250;
const RESULT_LINGER_MS = 3_000;

type DispatchPhase =
  | { kind: "idle" }
  | { kind: "listening"; target: DispatchAgentTarget }
  | { kind: "sending"; target: DispatchAgentTarget }
  | { kind: "sent"; target: DispatchAgentTarget; text: string }
  | { kind: "failed"; message: string };

function resolveTarget(link: DispatchLink): DispatchAgentTarget | null {
  if (link.host && link.agent) {
    return { serverId: link.host, agentId: link.agent };
  }
  return getDispatchAgentTarget();
}

function useTargetLabel(target: DispatchAgentTarget | null, fallback: string): string {
  return useSessionStore((state) => {
    if (!target) return fallback;
    const agent = state.sessions[target.serverId]?.agents.get(target.agentId);
    return agent ? agent.title?.trim() || providerLabel(agent.provider) : fallback;
  });
}

/**
 * The one-shot spoken prompt surface, docked like the Live Voice strip: it
 * belongs to no screen and must survive whatever the link opened onto. It
 * records the moment a `paseo://dispatch` request lands, transcribes on the
 * target's host, sends, and leaves. Hands-free by construction — silence after
 * speech sends, a second opening of the link sends, and nothing waits on a tap.
 */
export function DispatchStrip() {
  const request = useDispatchRequest();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { style: keyboardShiftStyle } = useKeyboardShiftStyle({ mode: "translate" });
  const [phase, setPhase] = useState<DispatchPhase>({ kind: "idle" });
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const trackerRef = useRef<DispatchSilenceTracker | null>(null);
  const handledSeqRef = useRef(0);
  const cueRef = useRef<LiveVoiceCuePlayer | null>(null);
  if (!cueRef.current) {
    cueRef.current = createLiveVoiceCuePlayer();
  }
  useEffect(() => () => cueRef.current?.dispose(), []);

  const target = "target" in phase ? phase.target : null;
  const targetLabel = useTargetLabel(target, t("dispatch.defaultTarget"));
  const client = useSessionStore((state) =>
    target ? (state.sessions[target.serverId]?.client ?? null) : null,
  );

  const fail = useCallback((message: string) => {
    cueRef.current?.play("disconnected");
    setPhase({ kind: "failed", message });
  }, []);

  const handleTranscript = useCallback(
    (text: string) => {
      const current = phaseRef.current;
      if (current.kind !== "listening") return;
      const sendClient = useSessionStore.getState().sessions[current.target.serverId]?.client;
      if (!sendClient) {
        fail(t("dispatch.errors.hostOffline"));
        return;
      }
      setPhase({ kind: "sending", target: current.target });
      const send = async () => {
        try {
          await sendClient.sendAgentMessage(current.target.agentId, text);
          cueRef.current?.play("connected");
          setPhase({ kind: "sent", target: current.target, text });
        } catch (error) {
          console.warn("[Dispatch] send failed", error);
          fail(t("dispatch.errors.sendFailed"));
        }
      };
      void send();
    },
    [fail, t],
  );

  const dictation = useDictation({
    client,
    onTranscript: handleTranscript,
    onError: (error) => {
      if (phaseRef.current.kind === "listening") {
        console.warn("[Dispatch] dictation failed", error);
        fail(error.message);
      }
    },
  });
  const {
    startDictation,
    confirmDictation,
    cancelDictation,
    isRecording,
    partialTranscript,
    volume,
  } = dictation;

  // A request is a start when idle and a "send" when already listening.
  useEffect(() => {
    if (!request || request.seq === handledSeqRef.current) return;
    handledSeqRef.current = request.seq;
    const current = phaseRef.current;
    if (current.kind === "listening") {
      void confirmDictation();
      return;
    }
    if (current.kind === "sending") return;
    const next = resolveTarget(request.link);
    if (!next) {
      fail(t("dispatch.errors.noTarget"));
      return;
    }
    trackerRef.current = createDispatchSilenceTracker(Date.now());
    setPhase({ kind: "listening", target: next });
  }, [confirmDictation, fail, request, t]);

  // Recording waits for the target's client: a cold start from the link may
  // land before the host session exists.
  useEffect(() => {
    if (phase.kind !== "listening" || isRecording) return;
    if (!client) return;
    void startDictation();
  }, [client, isRecording, phase.kind, startDictation]);

  useEffect(() => {
    if (phase.kind !== "listening" || !isRecording) return;
    const timer = setInterval(() => {
      const tracker = trackerRef.current;
      if (!tracker) return;
      const decision = tracker.observe({ now: Date.now(), partialTranscript, volume });
      if (decision === "send") {
        trackerRef.current = null;
        void confirmDictation();
      } else if (decision === "give_up") {
        trackerRef.current = null;
        void cancelDictation().finally(() => fail(t("dispatch.errors.nothingHeard")));
      }
    }, TICK_MS);
    return () => clearInterval(timer);
  }, [
    cancelDictation,
    confirmDictation,
    fail,
    isRecording,
    partialTranscript,
    phase.kind,
    t,
    volume,
  ]);

  useEffect(() => {
    if (phase.kind !== "sent" && phase.kind !== "failed") return;
    const timer = setTimeout(() => setPhase({ kind: "idle" }), RESULT_LINGER_MS);
    return () => clearTimeout(timer);
  }, [phase.kind]);

  const handleCancel = useCallback(() => {
    trackerRef.current = null;
    void cancelDictation();
    setPhase({ kind: "idle" });
  }, [cancelDictation]);
  const handleSend = useCallback(() => {
    trackerRef.current = null;
    void confirmDictation();
  }, [confirmDictation]);
  const handleDismiss = useCallback(() => setPhase({ kind: "idle" }), []);

  if (!isNative || phase.kind === "idle") {
    return null;
  }

  let status: string;
  let detail: string | null = null;
  switch (phase.kind) {
    case "listening":
      status = t("dispatch.listening");
      detail = partialTranscript.trim() || null;
      break;
    case "sending":
      status = t("dispatch.sending");
      break;
    case "sent":
      status = t("dispatch.sent", { target: targetLabel });
      detail = phase.text;
      break;
    case "failed":
      status = phase.message;
      break;
  }

  return (
    <Animated.View
      testID="dispatch-strip"
      // Rides the keyboard like the Live Voice strip: the window does not resize for it.
      style={[styles.container, { paddingBottom: insets.bottom }, keyboardShiftStyle]}
    >
      <View style={styles.bar}>
        <View style={phase.kind === "listening" ? styles.liveDot : styles.idleDot} />
        <Text style={styles.title}>{t("dispatch.label")}</Text>
        <Text style={styles.hostLabel}>{targetLabel}</Text>
        <Text style={phase.kind === "failed" ? styles.statusError : styles.status}>{status}</Text>
        <View style={styles.spacer} />
        {phase.kind === "listening" ? (
          <>
            <Button variant="secondary" size="sm" onPress={handleCancel} testID="dispatch-cancel">
              {t("dispatch.cancel")}
            </Button>
            <Button size="sm" onPress={handleSend} testID="dispatch-send">
              {t("dispatch.send")}
            </Button>
          </>
        ) : null}
        {phase.kind === "sent" || phase.kind === "failed" ? (
          <Pressable onPress={handleDismiss} accessibilityRole="button" testID="dispatch-dismiss">
            <Text style={styles.dismiss}>{t("dispatch.dismiss")}</Text>
          </Pressable>
        ) : null}
      </View>
      {detail ? (
        <Text numberOfLines={3} style={styles.detail}>
          {detail}
        </Text>
      ) : null}
    </Animated.View>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    borderTopWidth: theme.borderWidth[1],
    borderTopColor: theme.colors.border,
    backgroundColor: theme.colors.surface1,
  },
  bar: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
  },
  liveDot: {
    width: 8,
    height: 8,
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.statusSuccess,
  },
  idleDot: {
    width: 8,
    height: 8,
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.foregroundMuted,
  },
  title: {
    fontFamily: theme.fontFamily.ui,
    fontSize: theme.fontSize.sm,
    color: theme.colors.foreground,
  },
  hostLabel: {
    fontFamily: theme.fontFamily.ui,
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
  },
  status: {
    fontFamily: theme.fontFamily.ui,
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
  },
  statusError: {
    fontFamily: theme.fontFamily.ui,
    fontSize: theme.fontSize.sm,
    color: theme.colors.statusDanger,
  },
  spacer: {
    flex: 1,
  },
  dismiss: {
    fontFamily: theme.fontFamily.ui,
    fontSize: theme.fontSize.sm,
    color: theme.colors.foreground,
  },
  detail: {
    fontFamily: theme.fontFamily.ui,
    fontSize: theme.fontSize.sm,
    color: theme.colors.foreground,
    paddingHorizontal: theme.spacing[3],
    paddingBottom: theme.spacing[2],
  },
}));

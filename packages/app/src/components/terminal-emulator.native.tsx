import { requireNativeViewManager } from "expo-modules-core";
import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type ComponentType,
} from "react";
import { Keyboard, NativeModules, StyleSheet, type StyleProp, type ViewStyle } from "react-native";
import type { ITheme } from "@xterm/xterm";
import {
  TerminalInputModeTracker,
  terminalInputModeStatesEqual,
  type TerminalInputModeState,
} from "@getpaseo/protocol/terminal-input-mode";
import { renderTerminalSnapshotToAnsi } from "../terminal/runtime/terminal-snapshot";
import WebViewTerminalEmulator, {
  type TerminalEmulatorHandle,
  type TerminalEmulatorProps,
} from "./terminal-emulator-webview.native";

export type { TerminalEmulatorHandle };

interface NativeTerminalSurfaceRef {
  write(data: string): Promise<void>;
  replaceBuffer(data: string): Promise<void>;
  clear(): Promise<void>;
  focus(): Promise<void>;
  blur(): Promise<void>;
  refresh(): Promise<void>;
}

interface NativeTerminalSurfaceProps {
  ref?: (value: NativeTerminalSurfaceRef | null) => void;
  style?: StyleProp<ViewStyle>;
  testID?: string;
  terminalKey: string;
  initialBuffer: string;
  fontSize: number;
  focusRequest: number;
  autoFocus: boolean;
  swipeGesturesEnabled: boolean;
  appearanceScheme: "dark" | "light";
  themeConfig: string;
  backgroundColor: string;
  foregroundColor: string;
  mutedForegroundColor: string;
  onInput: (event: { nativeEvent: { data: string } }) => void;
  onTerminalKey: (event: {
    nativeEvent: { key: string; ctrl: boolean; shift: boolean; alt: boolean; meta: boolean };
  }) => void;
  onResize: (event: { nativeEvent: { cols: number; rows: number } }) => void;
  onFocus: () => void;
  onSwipeLeft: () => void;
  onSwipeRight: () => void;
  onSurfaceCreationError: () => void;
}

type NativeOperation = (surface: NativeTerminalSurfaceRef) => Promise<void>;

const DEFAULT_THEME: ITheme = {
  background: "#0b0b0b",
  foreground: "#e6e6e6",
  cursor: "#e6e6e6",
};

const PALETTE_KEYS = [
  "black",
  "red",
  "green",
  "yellow",
  "blue",
  "magenta",
  "cyan",
  "white",
  "brightBlack",
  "brightRed",
  "brightGreen",
  "brightYellow",
  "brightBlue",
  "brightMagenta",
  "brightCyan",
  "brightWhite",
] as const;

function hasNativeTerminalSurface(): boolean {
  const proxy = NativeModules.NativeUnimoduleProxy as
    | { viewManagersMetadata?: Record<string, unknown> }
    | undefined;
  return Boolean(proxy?.viewManagersMetadata?.PaseoTerminalSurface);
}

const NativeTerminalSurface = hasNativeTerminalSurface()
  ? (requireNativeViewManager<NativeTerminalSurfaceProps>(
      "PaseoTerminalSurface",
    ) as ComponentType<NativeTerminalSurfaceProps>)
  : null;
const NativeTerminalSurfaceComponent =
  NativeTerminalSurface as ComponentType<NativeTerminalSurfaceProps>;

function terminalThemeConfig(theme: ITheme): string {
  const lines = [
    `background = ${theme.background ?? DEFAULT_THEME.background}`,
    `foreground = ${theme.foreground ?? DEFAULT_THEME.foreground}`,
    `cursor-color = ${theme.cursor ?? theme.foreground ?? DEFAULT_THEME.cursor}`,
    `cursor-text = ${theme.cursorAccent ?? theme.background ?? DEFAULT_THEME.background}`,
  ];
  PALETTE_KEYS.forEach((key, index) => {
    const color = theme[key];
    if (color) lines.push(`palette = ${index}=${color}`);
  });
  return lines.join("\n");
}

function isLightColor(color: string): boolean {
  const match = /^#([0-9a-f]{6})$/i.exec(color);
  if (!match) return false;
  const value = Number.parseInt(match[1], 16);
  const red = (value >> 16) & 0xff;
  const green = (value >> 8) & 0xff;
  const blue = value & 0xff;
  return red * 0.299 + green * 0.587 + blue * 0.114 > 160;
}

function NativeTerminalEmulator({
  ref,
  streamKey,
  testId = "terminal-surface",
  xtermTheme = DEFAULT_THEME,
  fontSize = 12,
  initialSnapshot = null,
  onInput,
  onFocus,
  onResize,
  onTerminalKey,
  onInputModeChange,
  onRendererReadyChange,
  swipeGesturesEnabled = false,
  onSwipeLeft,
  onSwipeRight,
  focusRequestToken = 0,
  resizeRequestToken = 0,
  onSurfaceCreationError,
}: TerminalEmulatorProps & { onSurfaceCreationError: () => void }) {
  const surfaceRef = useRef<NativeTerminalSurfaceRef | null>(null);
  const outputDecoderRef = useRef(new TextDecoder());
  const readyRef = useRef(false);
  const pendingOperationsRef = useRef<NativeOperation[]>([]);
  const operationChainRef = useRef(Promise.resolve());
  const inputModeTrackerRef = useRef(new TerminalInputModeTracker());
  const lastInputModeRef = useRef<TerminalInputModeState>(inputModeTrackerRef.current.getState());
  const initialBufferRef = useRef("");
  const callbacksRef = useRef({
    onInput,
    onFocus,
    onResize,
    onTerminalKey,
    onInputModeChange,
    onRendererReadyChange,
    onSwipeLeft,
    onSwipeRight,
  });
  callbacksRef.current = {
    onInput,
    onFocus,
    onResize,
    onTerminalKey,
    onInputModeChange,
    onRendererReadyChange,
    onSwipeLeft,
    onSwipeRight,
  };

  const initialBuffer = useMemo(
    () => (initialSnapshot ? renderTerminalSnapshotToAnsi(initialSnapshot) : ""),
    [initialSnapshot],
  );
  initialBufferRef.current = initialBuffer;
  const backgroundColor = xtermTheme.background ?? DEFAULT_THEME.background!;
  const foregroundColor = xtermTheme.foreground ?? DEFAULT_THEME.foreground!;
  const mutedForegroundColor = xtermTheme.brightBlack ?? "#808080";
  const themeConfig = useMemo(() => terminalThemeConfig(xtermTheme), [xtermTheme]);

  const runOperation = useCallback((operation: NativeOperation) => {
    operationChainRef.current = operationChainRef.current
      .then(async () => {
        const surface = surfaceRef.current;
        if (surface) await operation(surface);
        return undefined;
      })
      .catch(() => undefined);
  }, []);

  const enqueueOperation = useCallback(
    (operation: NativeOperation) => {
      if (!readyRef.current || !surfaceRef.current) {
        pendingOperationsRef.current.push(operation);
        return;
      }
      runOperation(operation);
    },
    [runOperation],
  );

  const emitInputMode = useCallback(() => {
    const next = inputModeTrackerRef.current.getState();
    if (terminalInputModeStatesEqual(next, lastInputModeRef.current)) return;
    lastInputModeRef.current = next;
    callbacksRef.current.onInputModeChange?.(next);
  }, []);

  const resetInputMode = useCallback(
    (replacement = "") => {
      inputModeTrackerRef.current.reset();
      inputModeTrackerRef.current.feed(replacement);
      emitInputMode();
    },
    [emitInputMode],
  );

  useImperativeHandle(
    ref,
    (): TerminalEmulatorHandle => ({
      writeOutput: (data) => {
        const output = outputDecoderRef.current.decode(data, { stream: true });
        if (!output) return;
        if (inputModeTrackerRef.current.feed(output).changed) emitInputMode();
        enqueueOperation((surface) => surface.write(output));
      },
      restoreOutput: (data) => {
        outputDecoderRef.current.decode();
        const output = outputDecoderRef.current.decode(data);
        resetInputMode(output);
        enqueueOperation((surface) => surface.replaceBuffer(output));
      },
      renderSnapshot: (state) => {
        outputDecoderRef.current.decode();
        const output = state ? renderTerminalSnapshotToAnsi(state) : "";
        resetInputMode(output);
        enqueueOperation((surface) => surface.replaceBuffer(output));
      },
      clear: () => {
        outputDecoderRef.current.decode();
        resetInputMode();
        enqueueOperation((surface) => surface.clear());
      },
      blur: () => {
        enqueueOperation((surface) => surface.blur());
        Keyboard.dismiss();
      },
    }),
    [emitInputMode, enqueueOperation, resetInputMode],
  );

  useEffect(() => {
    outputDecoderRef.current.decode();
    readyRef.current = false;
    pendingOperationsRef.current = [];
    resetInputMode(initialBufferRef.current);
    return () => {
      callbacksRef.current.onRendererReadyChange?.({ streamKey, isReady: false });
    };
  }, [resetInputMode, streamKey]);

  useEffect(() => {
    resetInputMode(initialBuffer);
  }, [initialBuffer, resetInputMode]);

  useEffect(() => {
    if (focusRequestToken <= 0) return;
    enqueueOperation(async (surface) => {
      await surface.refresh();
      await surface.focus();
    });
  }, [enqueueOperation, focusRequestToken]);

  useEffect(() => {
    if (resizeRequestToken <= 0) return;
    enqueueOperation((surface) => surface.refresh());
  }, [enqueueOperation, resizeRequestToken]);

  const handleResize = useCallback(
    (event: { nativeEvent: { cols: number; rows: number } }) => {
      const { cols, rows } = event.nativeEvent;
      if (!readyRef.current) {
        readyRef.current = true;
        const pending = pendingOperationsRef.current.splice(0);
        pending.forEach(runOperation);
        callbacksRef.current.onRendererReadyChange?.({ streamKey, isReady: true });
      }
      callbacksRef.current.onResize?.({ cols, rows, shouldClaim: true });
    },
    [runOperation, streamKey],
  );
  const handleSurfaceRef = useCallback((surface: NativeTerminalSurfaceRef | null) => {
    surfaceRef.current = surface;
  }, []);
  const handleInput = useCallback((event: { nativeEvent: { data: string } }) => {
    callbacksRef.current.onInput?.(event.nativeEvent.data);
  }, []);
  const handleTerminalKey = useCallback(
    (event: {
      nativeEvent: { key: string; ctrl: boolean; shift: boolean; alt: boolean; meta: boolean };
    }) => {
      callbacksRef.current.onTerminalKey?.(event.nativeEvent);
    },
    [],
  );
  const handleFocus = useCallback(() => {
    callbacksRef.current.onFocus?.();
  }, []);
  const handleSwipeLeft = useCallback(() => {
    callbacksRef.current.onSwipeLeft?.();
  }, []);
  const handleSwipeRight = useCallback(() => {
    callbacksRef.current.onSwipeRight?.();
  }, []);

  return (
    <NativeTerminalSurfaceComponent
      ref={handleSurfaceRef}
      style={styles.surface}
      testID={testId}
      terminalKey={streamKey}
      initialBuffer={initialBuffer}
      fontSize={fontSize}
      focusRequest={focusRequestToken}
      autoFocus
      swipeGesturesEnabled={swipeGesturesEnabled}
      appearanceScheme={isLightColor(backgroundColor) ? "light" : "dark"}
      themeConfig={themeConfig}
      backgroundColor={backgroundColor}
      foregroundColor={foregroundColor}
      mutedForegroundColor={mutedForegroundColor}
      onInput={handleInput}
      onTerminalKey={handleTerminalKey}
      onResize={handleResize}
      onFocus={handleFocus}
      onSwipeLeft={handleSwipeLeft}
      onSwipeRight={handleSwipeRight}
      onSurfaceCreationError={onSurfaceCreationError}
    />
  );
}

const styles = StyleSheet.create({
  surface: {
    flex: 1,
    minWidth: 0,
    minHeight: 0,
  },
});

export default function TerminalEmulator(props: TerminalEmulatorProps) {
  const [nativeSurfaceFailed, setNativeSurfaceFailed] = useState(false);
  const handleSurfaceCreationError = useCallback(() => setNativeSurfaceFailed(true), []);
  if (!NativeTerminalSurface || nativeSurfaceFailed) {
    return <WebViewTerminalEmulator {...props} />;
  }
  return (
    <NativeTerminalEmulator
      key={props.streamKey}
      {...props}
      onSurfaceCreationError={handleSurfaceCreationError}
    />
  );
}

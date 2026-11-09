import { JSDOM } from "jsdom";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HostCustomColorModal } from "./host-custom-color-modal";

const { inputCallbacks, pickerCallbacks, theme } = vi.hoisted(() => ({
  inputCallbacks: {
    onChangeText: undefined as ((value: string) => void) | undefined,
  },
  pickerCallbacks: {
    onChangeJS: undefined as
      | ((colors: {
          hex: string;
          rgb: string;
          rgba: string;
          hsl: string;
          hsla: string;
          hsv: string;
          hsva: string;
          hwb: string;
          hwba: string;
        }) => void)
      | undefined,
  },
  theme: {
    spacing: { 2: 8, 3: 12 },
    fontSize: { sm: 13, base: 15 },
    borderRadius: { md: 6, lg: 8 },
    borderWidth: { 1: 1 },
    colors: {
      surface0: "#111",
      foreground: "#fff",
      border: "#555",
      palette: { red: { 300: "#f87171" } },
    },
  },
}));

vi.mock("react-native-unistyles", () => ({
  StyleSheet: {
    create: (factory: unknown) => (typeof factory === "function" ? factory(theme) : factory),
  },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("reanimated-color-picker", async () => {
  const ReactModule = await import("react");
  return {
    default: ({
      children,
      onChangeJS,
    }: {
      children: React.ReactNode;
      onChangeJS: typeof pickerCallbacks.onChangeJS;
    }) => {
      pickerCallbacks.onChangeJS = onChangeJS;
      return ReactModule.createElement("div", { "data-testid": "color-picker" }, children);
    },
    Panel1: () => ReactModule.createElement("div", { "data-testid": "color-panel" }),
    HueSlider: () => ReactModule.createElement("div", { "data-testid": "hue-slider" }),
  };
});

vi.mock("@/components/adaptive-modal-sheet", async () => {
  const ReactModule = await import("react");
  const AdaptiveModalSheet = ({
    visible,
    children,
    testID,
  }: {
    visible: boolean;
    children: React.ReactNode;
    testID?: string;
  }) => (visible ? ReactModule.createElement("div", { "data-testid": testID }, children) : null);
  const AdaptiveTextInput = ReactModule.forwardRef<
    { replaceText: (text: string) => void },
    {
      initialValue?: string;
      editable?: boolean;
      testID?: string;
      onChangeText?: (value: string) => void;
      onSubmitEditing?: () => void;
    }
  >((props, ref) => {
    const inputRef = ReactModule.useRef<HTMLInputElement>(null);
    inputCallbacks.onChangeText = props.onChangeText;
    ReactModule.useImperativeHandle(ref, () => ({
      replaceText: (text: string) => {
        if (inputRef.current) inputRef.current.value = text;
      },
    }));
    return ReactModule.createElement("input", {
      ref: inputRef,
      defaultValue: props.initialValue,
      disabled: props.editable === false,
      "data-testid": props.testID,
      onChange: (event: { target: { value: string } }) => props.onChangeText?.(event.target.value),
      onKeyDown: (event: { key: string }) => {
        if (event.key === "Enter") props.onSubmitEditing?.();
      },
    });
  });
  return { AdaptiveModalSheet, AdaptiveTextInput };
});

vi.mock("@/components/ui/button", async () => {
  const ReactModule = await import("react");
  return {
    Button: ({
      children,
      disabled,
      onPress,
      testID,
    }: {
      children: React.ReactNode;
      disabled?: boolean;
      onPress?: () => void;
      testID?: string;
    }) =>
      ReactModule.createElement(
        "button",
        {
          type: "button",
          disabled,
          "data-testid": testID,
          onClick: () => onPress?.(),
        },
        children,
      ),
  };
});

let root: Root | null = null;
let container: HTMLElement | null = null;

beforeEach(() => {
  const dom = new JSDOM("<!doctype html><html><body></body></html>");
  vi.stubGlobal("React", React);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("window", dom.window);
  vi.stubGlobal("document", dom.window.document);
  vi.stubGlobal("HTMLElement", dom.window.HTMLElement);
  vi.stubGlobal("Node", dom.window.Node);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  pickerCallbacks.onChangeJS = undefined;
  inputCallbacks.onChangeText = undefined;
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  container = null;
  vi.unstubAllGlobals();
});

function renderModal(options?: {
  color?: "none" | "teal" | `#${string}`;
  onClose?: () => void;
  onSubmit?: (color: `#${string}`) => Promise<void>;
}) {
  const props = {
    color: options?.color ?? ("none" as const),
    onClose: options?.onClose ?? vi.fn(),
    onSubmit: options?.onSubmit ?? vi.fn().mockResolvedValue(undefined),
  };
  act(() => {
    root?.render(<HostCustomColorModal visible {...props} />);
  });
  return props;
}

function queryInput(): HTMLInputElement {
  const input = document.querySelector<HTMLInputElement>(
    '[data-testid="host-appearance-custom-color-input"]',
  );
  if (!input) throw new Error("Color input not found");
  return input;
}

function clickSubmit(): void {
  const submit = document.querySelector<HTMLButtonElement>(
    '[data-testid="host-appearance-custom-color-submit"]',
  );
  if (!submit) throw new Error("Submit button not found");
  act(() => submit.click());
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("HostCustomColorModal", () => {
  it("starts from the selected preset color", () => {
    renderModal({ color: "teal" });

    expect(queryInput().value).toBe("#368080");
    expect(document.querySelector('[data-testid="color-panel"]')).not.toBeNull();
    expect(document.querySelector('[data-testid="hue-slider"]')).not.toBeNull();
  });

  it("synchronizes picker changes to the hex input and submits them", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();
    renderModal({ onSubmit, onClose });

    act(() => {
      pickerCallbacks.onChangeJS?.({
        hex: "#12abef",
        rgb: "",
        rgba: "",
        hsl: "",
        hsla: "",
        hsv: "",
        hsva: "",
        hwb: "",
        hwba: "",
      });
    });
    expect(queryInput().value).toBe("#12ABEF");

    clickSubmit();
    await flush();

    expect(onSubmit).toHaveBeenCalledWith("#12abef");
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("accepts shorthand hex typed into the precision field", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    renderModal({ color: "teal", onSubmit });
    const input = queryInput();

    act(() => {
      input.value = "abc";
      inputCallbacks.onChangeText?.("abc");
    });
    clickSubmit();
    await flush();

    expect(onSubmit).toHaveBeenCalledWith("#aabbcc");
  });
});

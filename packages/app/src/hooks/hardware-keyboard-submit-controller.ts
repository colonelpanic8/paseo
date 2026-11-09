export interface HardwareKeyboardSubmitEvent {
  /** Cmd/Ctrl was held: take the alternate send (queue while the agent runs). */
  alternate: boolean;
}

export interface HardwareKeyboardSubmitListenerPort {
  addListener(handler: (event?: HardwareKeyboardSubmitEvent) => void): { remove: () => void };
  setEnabled(enabled: boolean): void;
}

export interface HardwareKeyboardSubmitController {
  setOnSubmit(handler: (event: HardwareKeyboardSubmitEvent) => void): void;
  enable(): void;
  disable(): void;
}

const PLAIN_SUBMIT: HardwareKeyboardSubmitEvent = { alternate: false };

export function createHardwareKeyboardSubmitController(
  port: HardwareKeyboardSubmitListenerPort,
): HardwareKeyboardSubmitController {
  let subscription: { remove: () => void } | null = null;
  let onSubmit: (event: HardwareKeyboardSubmitEvent) => void = () => {};

  return {
    setOnSubmit(handler) {
      onSubmit = handler;
    },
    enable() {
      if (subscription) return;
      // A native build that predates the alternate flag sends no payload.
      subscription = port.addListener((event) => onSubmit(event ?? PLAIN_SUBMIT));
      port.setEnabled(true);
    },
    disable() {
      if (!subscription) return;
      port.setEnabled(false);
      subscription.remove();
      subscription = null;
    },
  };
}

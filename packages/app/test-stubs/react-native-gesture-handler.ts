// The package ships untranspiled syntax the unit project cannot parse, which takes out any test
// that reaches a menu surface through the adaptive sheet. Gestures are a device fact no unit test
// exercises, so the components pass children through and the builders are inert.
const PassThrough = ({ children }: { children?: unknown }) => children;

export const GestureHandlerRootView = PassThrough;
export const GestureDetector = PassThrough;
export const ScrollView = PassThrough;

export const Gesture = {
  Pan: () => ({}),
  Tap: () => ({}),
  Native: () => ({}),
  Simultaneous: (..._gestures: unknown[]) => ({}),
  Exclusive: (..._gestures: unknown[]) => ({}),
};

export const PointerType = { TOUCH: "touch", MOUSE: "mouse", STYLUS: "stylus", OTHER: "other" };

import { PointerType } from "react-native-gesture-handler";

export function shouldTrackNativePressHighlight(pointerType: PointerType): boolean {
  return pointerType !== PointerType.MOUSE;
}

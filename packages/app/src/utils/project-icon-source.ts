// React Native has no global Buffer; the polyfill has to be imported explicitly.
import { Buffer } from "buffer";
import { isNative } from "@/constants/platform";

/**
 * Project icons come straight off disk, so their mime type is whatever the repo
 * happened to ship: PNG, JPEG, GIF, WEBP, SVG, or ICO. Browsers render all of
 * those, but React Native's <Image> supports none of the last two — an SVG or
 * ICO data URI decodes to nothing and the row renders blank instead of falling
 * back to the initial. So on native we route SVG through react-native-svg and
 * treat ICO as "no icon".
 */
const SVG_MIME_TYPE = "image/svg+xml";

export interface ProjectIconDataUriParts {
  mimeType: string;
  base64: string;
}

export function parseProjectIconDataUri(dataUri: string): ProjectIconDataUriParts | null {
  const match = /^data:([^;,]+);base64,(.*)$/s.exec(dataUri);
  if (!match) {
    return null;
  }
  const [, mimeType, base64] = match;
  if (!mimeType || !base64) {
    return null;
  }
  return { mimeType: mimeType.toLowerCase(), base64 };
}

/**
 * The SVG markup for a data URI that native must render via react-native-svg.
 * The platform is an explicit parameter (defaulting to the real constant) so
 * tests can cover both variants without mocking module initialization.
 */
export function projectIconSvgXml(dataUri: string, native: boolean = isNative): string | null {
  if (!native) {
    return null;
  }
  const parts = parseProjectIconDataUri(dataUri);
  if (!parts || parts.mimeType !== SVG_MIME_TYPE) {
    return null;
  }
  try {
    return Buffer.from(parts.base64, "base64").toString("utf8");
  } catch {
    return null;
  }
}

/** False when the platform's <Image> cannot decode this icon at all (native ICO). */
export function canRenderProjectIconImage(dataUri: string, native: boolean = isNative): boolean {
  if (!native) {
    return true;
  }
  const parts = parseProjectIconDataUri(dataUri);
  if (!parts) {
    return true;
  }
  return parts.mimeType !== "image/x-icon" && parts.mimeType !== "image/vnd.microsoft.icon";
}

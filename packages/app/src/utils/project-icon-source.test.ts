import { describe, expect, it } from "vitest";
import {
  canRenderProjectIconImage,
  parseProjectIconDataUri,
  projectIconSvgXml,
} from "./project-icon-source";

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"></svg>';
const svgDataUri = `data:image/svg+xml;base64,${Buffer.from(SVG).toString("base64")}`;

describe("parseProjectIconDataUri", () => {
  it("splits mime type and payload", () => {
    expect(parseProjectIconDataUri("data:image/PNG;base64,abc")).toEqual({
      mimeType: "image/png",
      base64: "abc",
    });
  });

  it("returns null for anything that is not a base64 data URI", () => {
    expect(parseProjectIconDataUri("https://example.com/icon.png")).toBeNull();
    expect(parseProjectIconDataUri("data:image/png,abc")).toBeNull();
  });
});

describe("projectIconSvgXml", () => {
  it("decodes SVG icons on native so react-native-svg can render them", () => {
    expect(projectIconSvgXml(svgDataUri, true)).toBe(SVG);
  });

  it("leaves SVG icons to <img> on web", () => {
    expect(projectIconSvgXml(svgDataUri, false)).toBeNull();
  });

  it("leaves raster icons to <Image>", () => {
    expect(projectIconSvgXml("data:image/png;base64,abc", true)).toBeNull();
  });

  // React Native has no global Buffer. Vitest runs in Node, where it exists, so
  // a missing `import { Buffer } from "buffer"` decodes fine here and silently
  // returns null on device. Drop the global to keep the import honest.
  it("decodes without relying on a global Buffer", () => {
    const globals = globalThis as { Buffer?: unknown };
    const original = globals.Buffer;
    delete globals.Buffer;
    try {
      expect(projectIconSvgXml(svgDataUri, true)).toBe(SVG);
    } finally {
      globals.Buffer = original;
    }
  });
});

describe("canRenderProjectIconImage", () => {
  it("rejects ICO on native, where <Image> renders nothing", () => {
    expect(canRenderProjectIconImage("data:image/x-icon;base64,abc", true)).toBe(false);
    expect(canRenderProjectIconImage("data:image/vnd.microsoft.icon;base64,abc", true)).toBe(false);
  });

  it("accepts ICO on web, where browsers decode it natively", () => {
    expect(canRenderProjectIconImage("data:image/x-icon;base64,abc", false)).toBe(true);
  });

  it("accepts formats <Image> can decode", () => {
    expect(canRenderProjectIconImage("data:image/png;base64,abc", true)).toBe(true);
    expect(canRenderProjectIconImage("data:image/webp;base64,abc", true)).toBe(true);
  });
});

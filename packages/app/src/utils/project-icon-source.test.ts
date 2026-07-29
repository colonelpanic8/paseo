import { describe, expect, it, vi } from "vitest";

vi.mock("@/constants/platform", () => ({ isNative: true, isWeb: false }));

const { canRenderProjectIconImage, parseProjectIconDataUri, projectIconSvgXml } =
  await import("./project-icon-source");

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
    expect(projectIconSvgXml(svgDataUri)).toBe(SVG);
  });

  it("leaves raster icons to <Image>", () => {
    expect(projectIconSvgXml("data:image/png;base64,abc")).toBeNull();
  });

  // React Native has no global Buffer. Vitest runs in Node, where it exists, so
  // a missing `import { Buffer } from "buffer"` decodes fine here and silently
  // returns null on device. Drop the global to keep the import honest.
  it("decodes without relying on a global Buffer", () => {
    const globals = globalThis as { Buffer?: unknown };
    const original = globals.Buffer;
    delete globals.Buffer;
    try {
      expect(projectIconSvgXml(svgDataUri)).toBe(SVG);
    } finally {
      globals.Buffer = original;
    }
  });
});

describe("canRenderProjectIconImage", () => {
  it("rejects ICO on native, where <Image> renders nothing", () => {
    expect(canRenderProjectIconImage("data:image/x-icon;base64,abc")).toBe(false);
    expect(canRenderProjectIconImage("data:image/vnd.microsoft.icon;base64,abc")).toBe(false);
  });

  it("accepts formats <Image> can decode", () => {
    expect(canRenderProjectIconImage("data:image/png;base64,abc")).toBe(true);
    expect(canRenderProjectIconImage("data:image/webp;base64,abc")).toBe(true);
  });
});

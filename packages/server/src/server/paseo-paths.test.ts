import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";

import { resolvePaseoPaths } from "./paseo-paths.js";

const created: string[] = [];

function makeHome(): string {
  const home = mkdtempSync(path.join(tmpdir(), "paseo-paths-home-"));
  created.push(home);
  return home;
}

afterEach(() => {
  while (created.length > 0) {
    rmSync(created.pop() as string, { recursive: true, force: true });
  }
});

describe("resolvePaseoPaths", () => {
  test("PASEO_HOME keeps every category in one flat directory", () => {
    const home = makeHome();
    const paseoHome = path.join(home, "custom");

    const paths = resolvePaseoPaths({ HOME: home, PASEO_HOME: paseoHome });

    expect(paths.layout).toBe("flat");
    expect([paths.home, paths.config, paths.data, paths.state, paths.cache]).toEqual([
      paseoHome,
      paseoHome,
      paseoHome,
      paseoHome,
      paseoHome,
    ]);
  });

  test("an existing ~/.paseo keeps the current layout, ignoring XDG variables", () => {
    const home = makeHome();
    const legacy = path.join(home, ".paseo");
    mkdirSync(legacy);

    const paths = resolvePaseoPaths({
      HOME: home,
      XDG_CONFIG_HOME: path.join(home, "xdg-config"),
      XDG_CACHE_HOME: path.join(home, "xdg-cache"),
    });

    expect(paths.layout).toBe("flat");
    expect(paths.config).toBe(legacy);
    expect(paths.cache).toBe(legacy);
    expect(existsSync(path.join(home, "xdg-config"))).toBe(false);
  });

  test("a fresh install splits the categories across XDG roots", () => {
    const home = makeHome();

    const paths = resolvePaseoPaths({ HOME: home });

    expect(paths.layout).toBe("xdg");
    expect(paths.config).toBe(path.join(home, ".config", "paseo"));
    expect(paths.data).toBe(path.join(home, ".local", "share", "paseo"));
    expect(paths.home).toBe(paths.data);
  });

  test("state and cache share the data root until they are split", () => {
    const home = makeHome();

    const paths = resolvePaseoPaths({ HOME: home });

    expect(paths.state).toBe(paths.data);
    expect(paths.cache).toBe(paths.data);
  });

  test("a fresh install honors the XDG variables when they are set", () => {
    const home = makeHome();

    const paths = resolvePaseoPaths({
      HOME: home,
      XDG_CONFIG_HOME: path.join(home, "conf"),
      XDG_DATA_HOME: "~/dat",
    });

    expect(paths.config).toBe(path.join(home, "conf", "paseo"));
    expect(paths.data).toBe(path.join(home, "dat", "paseo"));
  });

  test("resolving never creates the legacy directory, so detection stays stable", () => {
    const home = makeHome();

    resolvePaseoPaths({ HOME: home });

    // Creating ~/.paseo here would silently pin every later call to the flat layout.
    expect(existsSync(path.join(home, ".paseo"))).toBe(false);
  });
});

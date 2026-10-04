import { expect, test } from "vitest";
import { daemonLaunchEnvironment } from "./config-environment.js";

test("managed XDG launches preserve categorized roots without forcing a flat home", () => {
  const env = daemonLaunchEnvironment({
    env: { PASEO_HOME: "/stale", PASEO_LISTEN: "127.0.0.1:9999" },
    home: "/data/paseo",
    paths: {
      home: "/data/paseo",
      config: "/config/paseo",
      data: "/data/paseo",
      state: "/data/paseo",
      cache: "/data/paseo",
      layout: "xdg",
    },
    mode: "managed",
  });

  expect(env.PASEO_HOME).toBeUndefined();
  expect(env.XDG_CONFIG_HOME).toBe("/config");
  expect(env.XDG_DATA_HOME).toBe("/data");
  expect(env.PASEO_LISTEN).toBeUndefined();
});

test("flat launches pass the selected home explicitly", () => {
  const env = daemonLaunchEnvironment({
    env: {},
    home: "/flat/paseo",
    mode: "managed",
  });

  expect(env.PASEO_HOME).toBe("/flat/paseo");
});

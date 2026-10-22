import { expect, test } from "vitest";
import { withSessionEnvironment } from "./environment.js";

test("session environment removes explicitly unset launch values without mutating the launch", () => {
  const launch = {
    command: "muse",
    args: [],
    env: { KEEP: "base", REPLACE: "base", REMOVE: "credential" },
  };
  expect(withSessionEnvironment(launch, { REPLACE: "session", REMOVE: null }).env).toEqual({
    KEEP: "base",
    REPLACE: "session",
  });
  expect(launch.env.REMOVE).toBe("credential");
});

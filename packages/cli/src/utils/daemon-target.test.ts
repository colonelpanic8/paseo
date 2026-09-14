import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test, expect } from "vitest";
import { selectDaemonTarget, describeDaemonTarget, localDaemonCommand } from "./daemon-target.js";

test("explicit selectors win over both environment selectors", () => {
  const env = { PASEO_HOME: "/tmp/a", PASEO_HOST: "unused:12345" };
  expect(selectDaemonTarget({ home: "/tmp/b" }, env)).toMatchObject({
    kind: "instance",
    home: "/tmp/b",
    paths: { layout: "flat", home: "/tmp/b" },
  });
  expect(selectDaemonTarget({ host: "chosen:23456" }, env)).toEqual({
    kind: "endpoint",
    host: "chosen:23456",
  });
  expect(() => selectDaemonTarget({}, env)).toThrow();
  expect(() => selectDaemonTarget({ home: "/tmp/b", host: "chosen:23456" }, {})).toThrow();
});

test("local operations ignore routing environment but reject an explicit endpoint", () => {
  expect(
    selectDaemonTarget({}, { PASEO_HOME: "/tmp/b", PASEO_HOST: "unused:12345" }, true),
  ).toMatchObject({ kind: "instance", home: "/tmp/b", paths: { layout: "flat" } });
  expect(() => selectDaemonTarget({ host: "chosen:23456" }, {}, true)).toThrow();
});

test.runIf(process.platform === "linux")(
  "an explicit home remains flat when it equals the implicit XDG data home",
  () => {
    const root = mkdtempSync(path.join(tmpdir(), "paseo-daemon-target-"));
    const env = {
      XDG_CONFIG_HOME: path.join(root, "config"),
      XDG_DATA_HOME: path.join(root, "data"),
    };
    const dataHome = path.join(root, "data", "paseo");
    mkdirSync(dataHome, { recursive: true });
    writeFileSync(path.join(dataHome, ".xdg-layout"), "1\n");
    try {
      expect(selectDaemonTarget({}, env, true)).toMatchObject({
        home: dataHome,
        paths: { layout: "xdg", config: path.join(root, "config", "paseo") },
      });
      expect(selectDaemonTarget({ home: dataHome }, env, true)).toMatchObject({
        home: dataHome,
        paths: { layout: "flat", config: dataHome },
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
);

test("local daemon commands preserve the selected layout", () => {
  expect(
    localDaemonCommand("start", {
      kind: "instance",
      home: "/tmp/data/paseo",
      paths: {
        home: "/tmp/data/paseo",
        config: "/tmp/config/paseo",
        data: "/tmp/data/paseo",
        state: "/tmp/data/paseo",
        cache: "/tmp/data/paseo",
        layout: "xdg",
      },
    }),
  ).toBe("paseo daemon start");
  expect(localDaemonCommand("reload", { kind: "instance", home: "/tmp/flat" })).toBe(
    'paseo daemon reload --home "/tmp/flat"',
  );
});

test("endpoint descriptions redact pairing material and credentials", () => {
  expect(
    describeDaemonTarget({
      kind: "endpoint",
      host: "tcp://user:private@example.test:23456?password=secret",
    }),
  ).not.toMatch(/private|secret/);
  expect(
    describeDaemonTarget({ kind: "endpoint", host: "https://app.paseo.sh/#offer=private" }),
  ).not.toContain("private");
});

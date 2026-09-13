import { parseHostTarget } from "@getpaseo/protocol/host-target";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test, expect } from "vitest";
import { selectDaemonTarget, describeDaemonTarget, localDaemonCommand } from "./daemon-target.js";
import {
  resolveDaemonCredential,
  resolveClientPaseoHome,
  buildDaemonConnectionCommandError,
} from "./client.js";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

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

test("endpoint connections resolve local credentials from PASEO_HOME", () => {
  expect(
    resolveClientPaseoHome(
      { kind: "endpoint", host: "localhost:6767" },
      { PASEO_HOME: "/tmp/custom-home" },
    ),
  ).toBe("/tmp/custom-home");
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

test("a pairing offer without a URL prefix still redacts its key", () => {
  const offer = {
    v: 2,
    serverId: "srv_example",
    daemonPublicKeyB64: "example-secret",
    relay: { endpoint: "localhost:6767", useTls: false },
  };
  const host = `#offer=${Buffer.from(JSON.stringify(offer)).toString("base64url")}`;
  expect(describeDaemonTarget({ kind: "endpoint", host })).toBe(
    "relay://localhost:6767/srv_example",
  );
});

test("malformed endpoint diagnostics never expose the supplied credential", () => {
  const target = { kind: "endpoint" as const, host: "alice:example-secret@localhost:6767" };
  expect(describeDaemonTarget(target)).not.toContain("example-secret");
  for (const message of [
    `Invalid connection ${target.host}`,
    `Cannot connect to daemon at ${target.host}`,
  ]) {
    const diagnostic = buildDaemonConnectionCommandError({ target, error: new Error(message) });
    expect(JSON.stringify(diagnostic)).not.toContain("example-secret");
  }
});

test("CLI selects an explicit password before a matching local credential and never sends the latter remotely", async () => {
  const home = await mkdtemp(join(tmpdir(), "paseo-cli-credential-"));
  const previousPassword = process.env.PASEO_PASSWORD;
  delete process.env.PASEO_PASSWORD;
  try {
    const token = "a".repeat(43);
    await writeFile(join(home, "paseo.pid"), JSON.stringify({ listen: "127.0.0.1:6767" }));
    await writeFile(join(home, "local-credential"), token);
    expect(resolveDaemonCredential("tcp://localhost:6767", home)).toEqual({
      kind: "localCredential",
      token,
    });
    expect(resolveDaemonCredential("tcp://remote.example:6767", home)).toBeNull();
    expect(resolveDaemonCredential("tcp://localhost:6767?password=explicit", home)).toEqual({
      kind: "password",
      password: "explicit",
    });
  } finally {
    if (previousPassword === undefined) delete process.env.PASEO_PASSWORD;
    else process.env.PASEO_PASSWORD = previousPassword;
    await rm(home, { recursive: true, force: true });
  }
});

test.each(["/tmp/paseo.sock", "\\\\.\\pipe\\paseo", "localhost:6767", "[::1]:6767", "6767"])(
  "validated bare target %s keeps its spelling in command hints",
  (host) => {
    expect(describeDaemonTarget({ kind: "endpoint", host })).toBe(host);
  },
);

test("validated URI command hints preserve their transport address without credentials", () => {
  const ssh = describeDaemonTarget({
    kind: "endpoint",
    host: "ssh://deploy@build-box:2222?daemonPort=7777&password=example-secret",
  });
  expect(ssh).not.toContain("example-secret");
  expect(parseHostTarget(ssh)).toMatchObject({
    kind: "ssh",
    ssh: { host: "deploy@build-box", sshPort: 2222, daemonPort: 7777 },
  });
  const ws = describeDaemonTarget({
    kind: "endpoint",
    host: "wss://example.test/custom-ws?authorization=example-secret",
  });
  expect(ws).not.toContain("example-secret");
  expect(new URL(ws).pathname).toBe("/custom-ws");
  expect(
    describeDaemonTarget({
      kind: "endpoint",
      host: "tcp://localhost:6767?daemonPort=example-secret&ssl=example-secret",
    }),
  ).not.toContain("example-secret");
});

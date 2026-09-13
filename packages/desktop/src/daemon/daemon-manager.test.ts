import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_DESKTOP_SETTINGS } from "../settings/desktop-settings";
import { createDaemonCommandHandlers } from "./daemon-manager";

const mocks = vi.hoisted(() => ({
  paseoHome: "",
  paseoPaths: { home: "", config: "", data: "", state: "", cache: "", layout: "flat" },
  settings: {
    releaseChannel: "stable",
    daemon: {
      manageBuiltInDaemon: true,
      keepRunningAfterQuit: true,
    },
  },
  runExternalCliJsonCommand: vi.fn(),
  runExternalCliTextCommand: vi.fn(),
  createNodeEntrypointInvocation: vi.fn(() => ({
    command: "node",
    args: [],
    env: {},
  })),
  spawnProcess: vi.fn(),
  logInfo: vi.fn(),
  logError: vi.fn(),
  appLogPath: "",
  getElectronLogFile: vi.fn(),
}));

vi.mock("electron", () => ({
  app: {
    getPath: vi.fn(() => mocks.paseoHome),
    getVersion: vi.fn(() => "1.2.3"),
    isPackaged: true,
  },
  ipcMain: { handle: vi.fn() },
  powerMonitor: { getSystemIdleTime: vi.fn(() => 0) },
}));

vi.mock("electron-log/main", () => ({
  default: {
    info: mocks.logInfo,
    error: mocks.logError,
    transports: {
      file: {
        getFile: mocks.getElectronLogFile,
      },
    },
  },
}));

vi.mock("@getpaseo/server", () => ({
  resolvePaseoHome: vi.fn(() => mocks.paseoHome),
  resolvePaseoPaths: vi.fn(() => mocks.paseoPaths),
  spawnProcess: mocks.spawnProcess,
}));

vi.mock("../settings/desktop-settings-electron.js", () => ({
  getDesktopSettingsStore: () => ({
    get: async () => mocks.settings,
    patch: vi.fn(),
    migrateLegacyRendererSettings: vi.fn(),
  }),
  getClientSettingsStore: () => ({
    get: vi.fn(),
    setField: vi.fn(),
    initialize: vi.fn(),
  }),
  loadDesktopSettingsSeed: async () => null,
}));

vi.mock("./runtime-paths.js", () => ({
  createNodeEntrypointInvocation: mocks.createNodeEntrypointInvocation,
  resolveDaemonRunnerEntrypoint: vi.fn(() => ({
    entryPath: path.join(mocks.paseoHome, "daemon.js"),
    execArgv: [],
  })),
}));

vi.mock("./cli/external.js", () => ({
  runExternalCliJsonCommand: mocks.runExternalCliJsonCommand,
  runExternalCliTextCommand: mocks.runExternalCliTextCommand,
}));

describe("daemon-manager commands", () => {
  let fixtureRoot: string;

  beforeEach(() => {
    fixtureRoot = mkdtempSync(path.join(tmpdir(), "paseo daemon manager "));
    mocks.paseoHome = path.join(fixtureRoot, "home");
    mocks.paseoPaths = {
      home: mocks.paseoHome,
      config: mocks.paseoHome,
      data: mocks.paseoHome,
      state: mocks.paseoHome,
      cache: mocks.paseoHome,
      layout: "flat",
    };
    mocks.appLogPath = path.join(fixtureRoot, "main.log");
    mocks.settings = DEFAULT_DESKTOP_SETTINGS;
    mocks.runExternalCliJsonCommand.mockReset();
    mocks.runExternalCliTextCommand.mockReset();
    mocks.createNodeEntrypointInvocation.mockReset();
    mocks.createNodeEntrypointInvocation.mockReturnValue({ command: "node", args: [], env: {} });
    mocks.spawnProcess.mockReset();
    mocks.logInfo.mockReset();
    mocks.logError.mockReset();
    mocks.getElectronLogFile.mockReset();
    mocks.getElectronLogFile.mockReturnValue({ path: mocks.appLogPath });
  });

  afterEach(() => {
    rmSync(fixtureRoot, { recursive: true, force: true });
  });

  it("returns the Electron main-process log tail from electron-log", () => {
    writeFileSync(
      mocks.appLogPath,
      Array.from({ length: 105 }, (_value, index) => `main log line ${index + 1}`).join("\n"),
    );
    const handlers = createDaemonCommandHandlers();

    expect(handlers.desktop_app_logs()).toEqual({
      logPath: mocks.appLogPath,
      contents: Array.from({ length: 100 }, (_value, index) => `main log line ${index + 6}`).join(
        "\n",
      ),
    });
  });

  it("exposes updater diagnostics through the desktop command boundary", () => {
    const diagnostics = createDaemonCommandHandlers().desktop_update_diagnostics();

    expect(diagnostics).toMatchObject({
      platform: process.platform,
      currentVersion: "1.2.3",
    });
  });

  it("forces the XDG daemon status probe to remain local", async () => {
    mocks.paseoPaths = {
      home: path.join(fixtureRoot, "xdg-data", "paseo"),
      config: path.join(fixtureRoot, "xdg-config", "paseo"),
      data: path.join(fixtureRoot, "xdg-data", "paseo"),
      state: path.join(fixtureRoot, "xdg-data", "paseo"),
      cache: path.join(fixtureRoot, "xdg-data", "paseo"),
      layout: "xdg",
    };
    mocks.runExternalCliJsonCommand.mockResolvedValue({ localDaemon: "stopped" });
    const previousHost = process.env.PASEO_HOST;
    const previousConfigHome = process.env.XDG_CONFIG_HOME;
    process.env.PASEO_HOST = "wss://remote.example.test";
    process.env.XDG_CONFIG_HOME = path.join(fixtureRoot, "xdg-config");
    try {
      await createDaemonCommandHandlers().desktop_daemon_status();
    } finally {
      if (previousHost === undefined) delete process.env.PASEO_HOST;
      else process.env.PASEO_HOST = previousHost;
      if (previousConfigHome === undefined) delete process.env.XDG_CONFIG_HOME;
      else process.env.XDG_CONFIG_HOME = previousConfigHome;
    }

    expect(mocks.runExternalCliJsonCommand).toHaveBeenCalledWith(["daemon", "status", "--json"], {
      env: expect.objectContaining({ XDG_CONFIG_HOME: path.join(fixtureRoot, "xdg-config") }),
    });
    expect(mocks.runExternalCliJsonCommand.mock.calls[0]?.[1]?.env.PASEO_HOST).toBeUndefined();
  });
});

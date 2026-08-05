/**
 * electron-builder config: `electron-builder.yml` plus the one thing YAML
 * cannot express — what to do when there is no Apple signing identity.
 *
 * A build without credentials still gets an ad-hoc signature, because arm64
 * macOS refuses to run an unsigned binary at all. But ad-hoc signing and the
 * hardened runtime together are a combination macOS rejects: the hardened
 * runtime turns on dyld library validation, which requires every loaded library
 * to share the main executable's Team ID, and an ad-hoc signature has no Team
 * ID. The app dies the instant it launches, on Electron Framework, with a
 * "different Team IDs" error. Only a `codesign --force --deep --sign -` over
 * the installed .app recovers it, which no downloader should have to do.
 *
 * So the hardened runtime — and notarization, which requires it — is switched
 * off for unsigned builds and left alone for signed ones. The alternative, a
 * `com.apple.security.cs.disable-library-validation` entitlement, would fix the
 * same crash by weakening the signed release for everyone; this only changes
 * the builds that are already unsigned.
 */

const fs = require("node:fs");
const path = require("node:path");

const yaml = require("js-yaml");

const CONFIG_PATH = path.join(__dirname, "electron-builder.yml");

/** An identity handed to us explicitly, the way CI passes a certificate. */
function hasConfiguredSigningIdentity(env) {
  return ["CSC_LINK", "CSC_NAME", "CSC_IDENTITY"].some((name) => (env[name] ?? "").trim() !== "");
}

/**
 * electron-builder also searches the local keychain. A CI runner has none of
 * the developer's certificates, so a bare `CI` with no credentials in the
 * environment is the fork-build case this exists for.
 */
function canDiscoverKeychainIdentity(env) {
  return !env.CI && env.CSC_IDENTITY_AUTO_DISCOVERY !== "false";
}

function isMacSigningAvailable(env) {
  return hasConfiguredSigningIdentity(env) || canDiscoverKeychainIdentity(env);
}

const config = yaml.load(fs.readFileSync(CONFIG_PATH, "utf8"));

if (!isMacSigningAvailable(process.env)) {
  config.mac = {
    ...config.mac,
    hardenedRuntime: false,
    // Notarization needs the hardened runtime and a Developer ID, so it could
    // only fail here. electron-builder would skip it anyway; saying so is
    // clearer than letting it warn.
    notarize: false,
  };
}

module.exports = config;

Partial macOS evidence is now available; the signed/notarized requirement remains outstanding, so I am leaving this PR closed.

Tested source branch: `b5f9c4913bb74490109365ce0f37d34ccbe699bd` (the original PR plus a focused workflow fix that unsets `CSC_LINK`/`CSC_KEY_PASSWORD` when the certificate value is empty).

The original run at `c523a90a87` failed before signing because Electron Builder treated the empty certificate path as `packages/desktop`, reporting `not a file`. The follow-up changes only that empty-variable handling; configured certificate values remain unchanged.

The Apple Silicon job in [run 34278532216](https://github.com/colonelpanic8/paseo/actions/runs/34278532216) succeeded on `macos-14`, arm64, with publishing disabled. Raw log excerpts:

```text
falling back to ad-hoc signature for macOS application code signing
signing file=release/mac-arm64/Paseo.app platform=darwin type=distribution identityName=- identityHash=none provisioningProfile=none
skipped macOS notarization reason=`notarize` options were set explicitly `false`
Packaged desktop smoke passed: real renderer and preload loaded; renderer-started desktop daemon pid 41014, listen 127.0.0.1:49228; CLI shim daemon status and terminal smoke succeeded
```

The smoke launches the packaged `.app` during the build, without manual re-signing. The produced DMG is `Paseo-0.5.0-beta.2-arm64.dmg`, SHA-256 `ebdbcb020e4273d1d6c70b129f33846882b4e8ab226e8a75ca5addc2118df871`. Read-only signature inspection of its extracted arm64 app and Electron Framework reports `CodeSignatureFlags(ADHOC)` with no runtime flag. That inspection was performed on Linux, not through macOS `codesign`.

Limits: no signed/notarized run was possible with this account's pull-only upstream access and no signing identity on the fork. This does not claim Gatekeeper acceptance or a separate launch from a mounted DMG. A maintainer with access to the upstream Apple signing credentials still needs to perform the certificate-backed build and notarization check.

The workflow change passed formatting, desktop typecheck, and Bash syntax checking. The repository lint script does not accept YAML files (`No files found to lint`). The original config suite passed 11 tests; the actual Apple Silicon build/smoke above validates the workflow change.

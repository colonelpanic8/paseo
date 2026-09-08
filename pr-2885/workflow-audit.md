# PR #2885 unsigned workflow audit

Audited commit: `c523a90a879433d4f908b1d12e02fc7c5f68bf79`

Fork workflow: `colonelpanic8/paseo/.github/workflows/desktop-release.yml`

Initial dispatch:

```text
workflow ref: colonelpanic8/desktop-adhoc-hardened-runtime
tag: v0.5.0-beta.2
platform: macos
checkout_ref: c523a90a879433d4f908b1d12e02fc7c5f68bf79
publish: false
rollout_hours: 0
run: https://github.com/colonelpanic8/paseo/actions/runs/34277407789
```

The branch resolved to the audited commit immediately before dispatch. The build checkout uses `${{ env.CHECKOUT_REF }}` directly, so supplying the immutable SHA prevents branch-head drift.

Nonpublication audit:

- Every platform build calls electron-builder with `--publish never`.
- `platform=macos` and `publish=false` skip `create-release`.
- `SHOULD_PUBLISH` evaluates false, so release upload and manifest upload steps are skipped.
- `publish=false` skips `finalize-rollout`, including its stamped-manifest release upload.
- The nonpublishing path uploads DMGs only as GitHub Actions workflow artifacts with seven-day retention.
- No tag, release, updater manifest, npm package, store build, or public release asset is created by this dispatch.

Expected macOS jobs:

- `macos-14`, `arm64` — required Apple Silicon evidence.
- `macos-15-intel`, `x64` — part of the workflow's fixed macOS matrix; not used as the Apple Silicon proof.

The signed/notarized upstream run is blocked because the available upstream access is pull-only. No upstream dispatch or secret-access workaround will be attempted.

## Initial-run finding and retry

The first arm64 job reached electron-builder but failed before signing or smoke launch:

```text
empty password will be used for code signing  reason=CSC_KEY_PASSWORD is not defined
⨯ /Users/runner/work/paseo/paseo/packages/desktop not a file
```

GitHub expands missing fork secrets to empty strings. Exporting `CSC_LINK=""` makes electron-builder resolve the empty certificate path to the desktop working directory. Commit `b5f9c4913bb74490109365ce0f37d34ccbe699bd` now unsets `CSC_LINK` and `CSC_KEY_PASSWORD` only when the certificate value is empty. Non-empty signed-build credentials are unchanged.

Validation for the CI fix:

- `npm ci`: success.
- `npm run build:server`: success.
- `npm run format`: success.
- `npm run lint`: 0 warnings and 0 errors across 3,717 files.
- `npm run typecheck`: success for every workspace.
- Commit pre-commit hook reran format checking and all workspace typechecks successfully.

An incorrectly expanded full SHA was caught immediately in queued run `34278515167`; that run was canceled before jobs started and is not evidence. The corrected retry is:

```text
checkout_ref: b5f9c4913bb74490109365ce0f37d34ccbe699bd
publish: false
run: https://github.com/colonelpanic8/paseo/actions/runs/34278532216
```

The obsolete first run was canceled after the decisive arm64 failure log was available so its still-running x64 sibling would not hold the concurrency group. Raw arm64 log: `/tmp/paseo-pr-evidence/2885/run-34277407789-arm64.log`.

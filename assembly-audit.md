# Codex banked resets: review and assembly integration

PR: https://github.com/getpaseo/paseo/pull/4386

All three review threads are resolved. The PR was rebased onto upstream `38c22139bb191f0ad27b11c16776e93504ddd4fd` and pushed at `423dea1aa2324e91b5c66db41ca60ac8170b070f`. Greptile's subsequent review passed with no unresolved threads.

The expected reset API/transport error boundary now preserves quota, while schema and unexpected errors propagate. Six browser scenarios express user intent through domain helpers. The 390px scenario checks full visibility, text clipping and overlap, then completes redemption.

## Assembly inputs

The base stayed at `92442e743517cb4f1c304967bd79e2b9401a6ba6`. All existing topic pins stayed unchanged.

Added `mine:assembly-codex-banked-resets` at `5f7d648ad1481ee8574b07f68a099783c4e0092a`. Its two commits replay the PR onto the older pinned base; `git range-diff` marks both identical. A direct PR merge would import unrelated upstream changes and produced 27 conflicts, so it was abandoned. PR #4386 is recorded as carried by the compatibility branch in the manifest exclusion reason; use the PR directly when the assembly base catches up.

Three files needed manual integration: usage list/settings preserve the assembly's used/remaining preference while passing the host ID to reset controls; the usage service preserves both provider-config revisions and reset cache generations. All three resolutions are tracked rerere pairs. The final locked build replayed all 35 conflict steps automatically and reproduced the locked tree exactly.

`patches/codex-banked-resets-usage-preferences.patch` scopes the browser test's “Used” assertion to the reset row, avoiding the existing percentage selector's identically named button. It changes tests only.

## Published result

- Previous published assembly: `c46e8fc59ff02a30f6075cd69f1aff0e6471d36a`
- Previous tree: `92f339876c1872d53fc88366d655af224585cb7f`
- Final assembly: `f9a021939242b8fa50a1670fd1242cc5d835e54e`
- Final tree: `9b90079169e07e085732729b8f15a15d1230ad71`
- Recipe main: `f0d7fda454a13df39ee2e88e47762e2120b215e5` (initial integration: `d2ecfdd29f61857a1128354696dbca9427597d0f`)
- Final verification: the locked rebuild reproduced the final tree exactly; all 35 conflict steps replayed automatically.
- npm dependency hash: `sha256-ulsNcv/UrRK4U4CFHix9MFZbrxmNIxB9dOmTsLrDucc=`

The final publication-stage dependency re-fetch passed: the declared hash reproduces the assembled package-lock.json.

## Verification

- PR: 16 provider/service tests, all 9 usage browser cases, format, lint, and workspace typechecks pass.
- Assembly: 86 focused provider/service tests and all 6 banked reset browser cases pass. Server/CLI build, workspace typecheck, and scoped format/lint pass. The native audio package needed building before typecheck in the fresh checkout.
- Final test-only adjustment was validated before the locked rebuild; the rebuilt tree contains that exact patch. No product code changed after validation.
- See `assembly-locked.log`, `assembly-tests.log`, `assembly-browser.log`, `assembly-typecheck.log`, `assembly-lint.log`, and `assembly-publish.log` for raw results.
- No real banked reset was spent. Browser fixtures use an isolated daemon. Native devices and Electron were not exercised; no full test suite was run.

## Preserved work and tool recovery

The checkout contained a paused upstream refresh from another session. It remains preserved in named local stash `44e91aa43b7e3ba71517b455298131860507e023` (“Paused upstream refresh before PR 4386 integration (session 6f8dd07)”). This integration does not remove its blocked Live Voice features or move existing assembly pins.

The assembler initially failed while harvesting the settings resolution. Resuming and a clean rebuild recovered the missing pair; the final locked reproduction passed. Its normal build/resume path also automatically republished two reconstructed review branches. Both were restored with explicit leases to their pre-operation heads: `watch-live-voice` at `b569ee5f0d1829856bcbeb1c1298ac21a7b15d73` and `keyboard-shortcuts-mobile` at `be84456199670ec438db3562b78f9f2b9b4048ed`.

The installed Paseo daemon was not restarted or repinned.

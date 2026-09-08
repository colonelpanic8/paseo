# PR 3662 evidence bundle

## Scope

- PR: getpaseo/paseo#3662
- Head: `77dbc41eee1ac3b14136dcb0454e2b36fc460c11`
- Before: `92442e743517cb4f1c304967bd79e2b9401a6ba6`
- Intermediate serialized revision: `42b13998bf37cf3f01004bd1b14b43824bf47a5c`
- Worktree: `/home/imalison/Projects/paseo/.worktrees/evidence-3662`
- Platform: NixOS 26.11, Linux x86_64
- Codex: 0.147.0 native Linux x64 binary

## Harnesses

- `real-concurrent-starts.ts`: 24 concurrent caller-facing `listImportableSessions()` operations with instrumentation through the constructor dependency seam.
- `real-recovery.ts`: real native process stall/failure scenarios against the production startup coordinator and transport.

## Canonical raw results

- `results/before-direct-canonical.txt`
- `results/after-direct-77dbc41.txt`
- `results/legacy-stall-direct-42b1399.txt`
- `results/final-stall-direct-default-77dbc41.txt`
- `results/final-failure-direct-77dbc41.txt`
- `results/build-server-77dbc41.txt`
- `results/focused-tests-77dbc41.txt`
- `results/typecheck-server-77dbc41.txt`
- `results/lint-77dbc41.txt`
- `results/format-check-77dbc41.txt`
- `results/environment-and-diff-check-77dbc41.txt`
- `results/remote-branch-state.txt`

Each transcript produced by `script` includes its exact command, start time, raw output, and exit code.

## Remote branch state

Commit `77dbc41eee1ac3b14136dcb0454e2b36fc460c11` was pushed as a normal fast-forward to `colonelpanic8/paseo:fix/codex-sqlite-init`. GitHub's API still reports the closed PR's head as `701e88bafc9cca05da45bc311150724deeac29b8`; confirm that the PR picks up the branch tip when it is reopened. `results/remote-branch-state.txt` records both refs.

## Isolation

All test state is under `runtime/`. No `auth.json` or `config.toml` was copied or created. The bundle archive excludes `runtime/`, `tooling/`, and `diagnostics/`.

## Diagnostics excluded from review bundle

`diagnostics/` contains superseded wrapper-based runs and setup failures caused by stale/unbuilt workspace dependencies. They are retained locally for auditability but are not evidence for the PR.

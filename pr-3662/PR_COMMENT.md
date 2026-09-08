Evidence for the requested concurrent real Codex app-server scenario is below.

Tested Paseo head: `77dbc41eee1ac3b14136dcb0454e2b36fc460c11`  
Pre-change parent: `92442e743517cb4f1c304967bd79e2b9401a6ba6`  
Codex: `codex-cli 0.147.0`, invoked as the native Linux x64 ELF binary  
Host: NixOS 26.11, Linux x86_64, Node 24.19.0

## Isolation and method

Every scenario used a newly created empty `CODEX_HOME` under `/tmp/paseo-pr-evidence/3662/runtime`. I did not copy `auth.json`, `config.toml`, sessions, or any SQLite file from the active user home; the test homes contain only state created by these runs. No prompt/model request was made, so provider credentials were not needed. The main Paseo daemon and existing dev servers were not touched.

The concurrency harness starts 24 caller-facing `CodexAppServerAgentClient.listImportableSessions()` operations at once. Its constructor dependency seam wraps the production `CodexAppServerClient` only to timestamp real process and `initialize` activity. The RPC requests, process lifecycle, `thread/list`, and disposal all use production code against actual `codex app-server` binaries.

## Before/after: 24 callers, one shared empty `CODEX_HOME`

| Paseo revision | Calls | Success | SQLite init failures | Max real app-servers | Max simultaneous `initialize` RPCs | Elapsed |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Before, `92442e7435` | 24 | 22 | 2 | 24 | 24 | 1348.8 ms |
| After, `77dbc41eee` | 24 | 24 | 0 | 2 | 1 | 2096.9 ms |

The two active processes measured after the change are expected: after one process finishes `initialize`, it can still be completing `thread/list`/disposal while the next process initializes. Initialization itself never exceeded one active RPC.

Raw summaries:

```json
{
  "sourceSha": "92442e743517cb4f1c304967bd79e2b9401a6ba6",
  "requestedStarts": 24,
  "succeeded": 22,
  "failed": 2,
  "sqliteInitializationFailures": 2,
  "maxActiveProcesses": 24,
  "maxActiveInitializations": 24,
  "elapsedMs": 1348.8
}
{
  "sourceSha": "77dbc41eee1ac3b14136dcb0454e2b36fc460c11",
  "requestedStarts": 24,
  "succeeded": 24,
  "failed": 0,
  "sqliteInitializationFailures": 0,
  "maxActiveProcesses": 2,
  "maxActiveInitializations": 1,
  "elapsedMs": 2096.9
}
```

Both pre-change failures contained the exact runtime error this PR handles:

```text
Error: failed to initialize sqlite state runtime under /tmp/paseo-pr-evidence/3662/runtime/before-direct-canonical: failed to initialize state runtime at /tmp/paseo-pr-evidence/3662/runtime/before-direct-canonical
```

The complete process/RPC event streams and exact commands are in `before-direct-canonical.txt` and `after-direct-77dbc41.txt`.

## Stalled-start recovery

I ran the production startup coordinator and transport with two queued real native app-server binaries sharing one empty home. The first binary was stopped with `SIGSTOP` during `initialize`; the second was queued concurrently.

At the earlier serialized revision `42b13998bf`, the second binary had still not started after 1500 ms and only proceeded after the harness manually killed the stalled process. This demonstrates the unbounded queue failure addressed by the head commit.

At final head `77dbc41eee`, I used the production default deadline rather than a shortened test override:

```text
     5.2 ms  first real app-server stopped during initialize
  1506.7 ms  second startup still correctly queued
 30006.8 ms  production 30-second timeout begins cleanup
 32057.4 ms  cleanup finished after the stopped process required SIGKILL
 32059.7 ms  queued second real app-server spawned
 32182.1 ms  queued second initialize succeeded
 32183.3 ms  queued second thread/list succeeded
```

The first caller rejected with `Codex app-server startup timed out after 30000ms`; the queued caller fulfilled successfully. Full transcripts: `legacy-stall-direct-42b1399.txt` and `final-stall-direct-default-77dbc41.txt`.

## Failed-start recovery

I also forced the first real native process to fail with `SIGKILL` during `initialize` while a second startup was queued at final head:

```text
  3.4 ms  first real app-server spawned
  4.5 ms  forced failure sent during initialize
  6.8 ms  first process exited with SIGKILL
  9.0 ms  queued second real app-server spawned
119.9 ms  queued second initialize succeeded
121.0 ms  queued second thread/list succeeded
```

The failed caller rejected with the real process exit error; the queued caller fulfilled. Full transcript: `final-failure-direct-77dbc41.txt`.

## Automated checks and test-quality review

At `77dbc41eee` after a clean lockfile install and `npm run build:server`:

The final commit is a test-quality-only follow-up: it replaces the stalled-start test's global fake timers with an injected timer port. Production still defaults to the same system `setTimeout`/`clearTimeout` behavior exercised by the 30-second real-process run above.

```text
Test Files  2 passed (2)
Tests       9 passed (9)

server typecheck: passed
targeted lint: 0 warnings, 0 errors
targeted format check: passed
git diff --check: passed
```

The new coordinator tests use injected startup and timer ports with deterministic deferred promises and a manual timer; they do not patch global time. They cover serialization, fresh-process SQLite retries, queued cancellation, cleanup ordering after a never-settling startup, and immediate failure for unrelated errors. The caller-level retry test uses the constructor dependency seam and calls `listImportableSessions()`; it does not mutate private client state. The manual real-process runs above cover the important remaining seam that a deterministic unit test cannot: actual Codex SQLite behavior and real process-tree cleanup.

Raw check transcripts are included for the build, focused tests, server typecheck, targeted lint, targeted format check, environment, and diff check.

## Coverage gaps

- Real-process evidence was run on Linux x86_64 only; macOS and Windows were not available.
- The contention reproduction intentionally pins Codex 0.147.0, the affected version named in the PR. Current installed Codex 0.153.4 was not used for the before/after comparison.
- This is daemon/provider behavior with no UI surface, so screenshots or video would add no evidence beyond the raw process/RPC timelines.

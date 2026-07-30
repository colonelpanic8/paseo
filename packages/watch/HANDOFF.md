# Wear OS handoff

Working state for whoever picks this up next. Transient by nature — delete it once
the open work below is done. Durable facts live in [README.md](README.md) and
[design/README.md](design/README.md); read both, they are short.

Branch: `assembly-wear-os` on remote `fork` (local checkout may be named
`wearos-voice-transcription`). Assembly recipe: `~/Projects/paseo-assembly`.

## It works end to end

The phone→watch Wearable Data Layer hop is **confirmed working on real hardware**:
live workspaces, project icons, provider, and status render on a Pixel Watch 3 from
the user's actual daemons. Everything below assumes that baseline.

## The one rule that will waste your day if you miss it

**The Data Layer only routes between a phone app and a watch app that share BOTH
`applicationId` and signing certificate.** Get either wrong and nothing crosses:
puts succeed, listeners register, node discovery works, and Play Services reports
**no error to either side**. The watch just waits forever.

This is why the watch's `applicationId` is a Gradle property, not a fixed value
(`app/build.gradle.kts`). Default `sh.paseo.debug`; the F-Droid pipeline passes
`-PpaseoApplicationId=sh.paseo.assembly` and signs with the phone's key. The Kotlin
`namespace` stays `sh.paseo.watch` — only the install identity varies, so the launch
component is `<applicationId>/sh.paseo.watch.MainActivity`.

If the watch shows **"waiting for phone"**, no snapshot has ever arrived. If it shows
**"No workspaces on your connected hosts"**, the hop works and the problem is
upstream in snapshot content. That split exists specifically to tell those apart —
trust it instead of inferring from log silence, because both sides only log failures.

## Connecting to the devices

Both are on the user's home LAN, DHCP moves them, and **the watch's wireless-debug
port changes whenever the toggle is cycled**. Last known good:

| Device         | Address               | Notes                                                                               |
| -------------- | --------------------- | ----------------------------------------------------------------------------------- |
| Pixel Watch 3  | `192.168.0.10:36963`  | also seen at `.53`; paired already (`adb-47291JEAYW08L5-B5vEF3`), so no code needed |
| Pixel 9 Pro XL | `192.168.0.241:45753` | also reachable over tailscale as `100.127.119.119`                                  |

When the address is stale, sweep and rescan rather than asking:

```bash
for i in $(seq 1 254); do (ping -c1 -W1 192.168.0.$i >/dev/null 2>&1 && echo 192.168.0.$i) & done; wait
nmap -p 30000-50000 --open -T5 -n 192.168.0.<candidate>    # via: nix run nixpkgs#nmap --
adb connect 192.168.0.<ip>:<port>
```

Gotchas that cost real time:

- **Wear OS powers WiFi down when the screen is off and the phone is in Bluetooth
  range.** `ping` gives 100% loss and `adb connect` says _No route to host_. Not a
  config problem — put it on the charger or wake it.
- **`adb pair` ports die when the pairing dialog closes.** Need port + 6-digit code
  together, in one shot. Pairing is already done, so this shouldn't recur.
- **The Bluetooth tunnel** (`adb forward tcp:4444 localabstract:/adb-hub`, then
  `adb connect 127.0.0.1:4444`) is immune to WiFi sleep and IP churn, but needs
  _Wear OS app → Advanced → Debug over Bluetooth_ on the phone. Never got enabled;
  worth preferring if WiFi keeps fighting you.
- **`screencap` returns a 1772-byte black PNG** when the screen is asleep, even
  though `dumpsys window` reports `mAwake=true`. Fix:
  ```bash
  adb -s $W shell settings put system screen_off_timeout 600000
  adb -s $W shell input keyevent 224; adb -s $W shell input swipe 225 300 225 200
  ```

## Build and install

Toolchain is nix-store paths, and **nix GC deleted the SDK mid-session once** —
there is a GC root at `~/.paseo-wear-gcroots/androidsdk`, but re-resolve if it
vanishes (`ls -d /nix/store/*androidsdk*/libexec/android-sdk`).

```bash
export JAVA_HOME=/nix/store/102gxd1lf8cniz9zzsxn7mdmnar8w0jz-openjdk-21.0.12+2
export ANDROID_HOME=/nix/store/hdzxpm2dgj342sjlgygdivzvwgbaisnj-androidsdk/libexec/android-sdk
export PATH="$JAVA_HOME/bin:/run/current-system/sw/bin:$PATH"
cd packages/watch && ./gradlew :app:testDebugUnitTest :app:assembleDebug
```

Use `./gradlew`, never a system `gradle`. Install to the watch with the identity
that matches the installed phone app — for the F-Droid phone build that means
downloading the signed watch artifact from CI, not a local debug build:

```bash
gh run download <fdroid-run-id> -D /tmp/fd   # in ~/Projects/paseo-assembly, inside nix develop
# artifacts: paseo-assembly-<code> (phone), paseo-watch-assembly-<code> (watch)
adb -s $W install -r /tmp/fd/paseo-watch-assembly-*/*.apk
```

`find -L` is required for anything under `$ANDROID_HOME/build-tools` — each version
dir is a symlink into its own store path, and an unfollowed `find` silently finds
nothing. Also: `apksigner` needs `java` on PATH or it fails with `exec: java: not found`.

## Landing a change in the user's build

`assembled` is **compiled output — never hand-commit to it or base work on it.**
Read `~/.agents/project-guides/paseo-assembly.md` and the assembly repo's
`AGENTS.md` before touching it; the full fork-fold guide loads with
`nix eval --no-write-lock-file --raw .#lib.forkFoldAgentGuide`.

The cycle, all from `~/Projects/paseo-assembly` inside `nix develop`:

```bash
git push fork HEAD:refs/heads/assembly-wear-os      # from the paseo worktree first
fork-fold update assembly-wear-os && fork-fold build
.worktrees/build/scripts/update-nix.sh --check      # see hash note below
fork-fold build --locked                            # must reproduce the lock's tree
git -C .worktrees/source push --force-with-lease=refs/heads/assembled:<old> mine <new>:refs/heads/assembled
git add manifest.lock.json && git commit && git push origin HEAD:main   # this triggers CI
```

`assembled` gets **force-pushed** — a rebuild rewrites every commit after the edited
entry. That is normal; use `--force-with-lease`.

Two traps here:

- **Any change to `package-lock.json` invalidates `patches/assembled-npm-deps-hash.patch`**,
  which is a function of the whole assembled dependency tree. Symptom: desktop CI
  fails with `npmDepsHash is out of date`. Fix by taking the value
  `scripts/update-nix.sh` writes into the build tree (self-consistent by
  construction), then `fork-fold update assembled-npm-deps-hash` and rebuild. Do
  **not** copy a hash out of a `--check` message; one run reported a different value
  than the two either side of it.
- **Never hand-edit `package-lock.json`, and never commit one produced by a bare
  `npm install` on this machine.** `npm config get omit` is `dev` and
  `NODE_ENV=production`, so a plain install rewrites the lock destructively (~847
  insertions / 1358 deletions, pruning platform-specific optional deps that would
  break macOS). Use `scripts/update-nix.sh`, which runs `scripts/fix-lockfile.mjs`.

Unrelated pre-existing breakage you will hit: the lefthook pre-commit hook fails on
`packages/expo-two-way-audio` typecheck (`Cannot find type definition file for
'jest-require'`) because that package's tsconfig looks for `expo-module-scripts`
package-locally while npm hoists it. Not caused by this work; `--no-verify` after
checking your own code is clean.

CI lives in the assembly repo (the fork has Actions disabled — 0 runs ever):
`watch.yml` (build + tests, ~6min), `desktop.yml` (~6min), `fdroid.yml` (~21–25min,
produces both signed APKs).

## Done so far

- Wear app: workspace list, agent picker, agent detail, permission approve/deny,
  reply (voice + canned). Workspaces are the browsing unit; `Workspace.destination()`
  in `model/Models.kt` is the **single** place the "1 agent skips the picker, 0 agents
  goes to voice" rule lives.
- Voice/typing via Wear's system input sheet (`RecognizerIntent`,
  `EXTRA_PREFER_OFFLINE`). No audio code, no `RECORD_AUDIO`. Paseo's daemon-side
  dictation is deliberately unused.
- Bridge: `packages/expo-wear-bridge` (Expo module) + `packages/app/src/wear/`.
  Snapshots over `DataClient`, commands over `MessageClient`.
- `use-wear-bridge.android.ts` + a no-op base keeps the Android-only native module
  out of non-Android bundles (Metro platform split, per CLAUDE.md).
- Watch APK built and signed by the F-Droid pipeline with the phone's key
  (`scripts/fdroid-build-watch.sh`); version code uses ABI slot 5 so it cannot
  collide with the phone's 1–4.
- Launcher icon is the real Paseo butterfly, path copied byte-identical from
  `packages/app/assets/images/butterfly-white.svg`.
- 27 phone-side tests, 10 watch unit tests, 1 on-device instrumented test.

## Open work

Three UI asks from the user, in their priority order:

1. **Conversation scrollback on the agent screen.** Today it shows only
   `summary`, which is the daemon's _agent title_, capped at 3 lines — not a
   transcript. This is the substantial one; design sketch below.
2. **A text reply path.** The reply screen's keyboard button currently launches
   `RecognizerIntent` with a keyboard hint, so text entry is buried behind the voice
   sheet. Wear's `RemoteInputIntent.ACTION_REMOTE_INPUT` opens the system input
   picker directly (keyboard + handwriting + voice + canned) and is probably the
   right call.
3. **De-emphasize Stop** on the agent screen — smaller and less prominent than
   Reply. Currently both are 52dp `ActionButton`s about 10dp apart.

### Transcript design sketch (undecided, needs the user's call)

The worry was never size in the abstract — it is that a Paseo timeline is **not just
text**. It is tool calls, file reads, diffs, terminal output, reasoning blocks.
DataItem and MessageClient payloads cap around **100 KB**, and one `Bash` result or
file read can blow that alone. A _projected_ tail (assistant prose + user prompts,
tool calls collapsed to one line) is a few KB for dozens of turns.

So the work is projection, not transport. Proposed shape, an extension of the
existing protocol rather than a new one:

- **New command kind** `requestTranscript` in the `WireCommand` union (both
  `data/WearBridge.kt` and `wear-protocol.ts` — hand-mirrored, no codegen; the
  watch's `WearBridgeTest` pins the JSON).
- **New DataItem path** `/paseo/transcript/<agentId>`, kept out of the snapshot,
  which republishes on every store change and must stay small. On-demand, per agent.
- **Source**: `client.fetchAgentTimeline(agentId, {limit, direction, projection})`
  already exists, is paged, and is authoritative per `docs/timeline-sync.md`.
  `projection: "projected"` is the daemon's own collapsed view — prefer it over
  re-deriving on the phone.

Open questions for the user:

- **What is an "entry"?** Leaning: one assistant message or one user prompt, each
  truncated (~300 chars), with tool calls either collapsed to a single line
  (`Bash: git push origin …`) or dropped entirely. **Text-only would genuinely
  simplify this** — it removes per-kind rendering on the watch and makes the cap
  trivially safe.
- **How far back?** ~20 entries in one round trip, or crown-paged for older?
  Paging costs work on both sides.

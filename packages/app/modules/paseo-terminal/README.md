# Paseo Mobile Terminal Native Module

This local Expo module owns the native terminal surface for the mobile app.

The JavaScript contract is intentionally small:

- input from the native surface is emitted as `{ data: string }`
- resize from the native surface is emitted as `{ cols: number, rows: number }`
- remote PTY output is delivered by the existing `WsRpcClient.terminal` RPC stream

The iOS implementation uses the vendored `GhosttyKit.xcframework` built from the Ghostty custom-I/O
fork, with T3 Code's iOS 16 compatibility patch applied. `PaseoTerminalView` owns a `libghostty`
surface and uses its custom-I/O model:

1. initialize libghostty once for the process
2. create one Ghostty app and surface per native view
3. feed remote output into the surface with `ghostty_surface_feed_data`
4. collect user input with a hidden native text field and send it back to JS
5. emit Ghostty's measured terminal size through `onResize`

Ghostty's terminal-generated query replies are deliberately discarded on both platforms. Paseo's
daemon already owns those replies, and forwarding a second copy from the renderer would corrupt the
PTY input stream.

Android implements the same view contract with upstream `libghostty-vt` for terminal state, parsing,
reflow, and scrollback. An Android Canvas view renders compact snapshots produced by the JNI bridge,
so the React Native screen and RPC code stay platform-neutral.

Incremental output is fed directly to Ghostty instead of being retained in a second, unbounded
string. Only the latest Paseo snapshot/restore payload is kept for native surface recreation.

Vendored Ghostty revision and license details are in `THIRD_PARTY_NOTICES.md`.

## Rebuilding GhosttyKit

The checked-in `GhosttyKit.xcframework` is built from the Ghostty custom-I/O fork (https://github.com/Yash-Singh1/ghostty/tree/custom-io).
Set the directory to the cloned repository checked out on the `custom-io` branch to `GHOSTTY_SOURCE_DIR`.

```bash
packages/app/modules/paseo-terminal/scripts/build-libghostty-ios16.sh
```

The script builds Ghostty with Zig 0.15.2, strips the iOS archives, and replaces only the
`ios-arm64` and `ios-arm64-simulator` slices. Xcode's Metal toolchain must be installed; if `metal`
fails, run `xcodebuild -downloadComponent MetalToolchain`.

## Rebuilding libghostty-vt for Android

The checked-in Android shared libraries and headers are pinned to the revision recorded in
`Vendor/libghostty-vt/VERSION`. Set `ANDROID_NDK_HOME` and run:

```bash
packages/app/modules/paseo-terminal/scripts/build-libghostty-android.sh
```

The script downloads Zig 0.15.2 when needed, checks out the pinned upstream Ghostty revision, and
rebuilds all four Android ABIs with 16 KB page-size support.

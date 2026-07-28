{
  lib,
  stdenv,
  buildNpmPackage,
  nodejs_22,
  python3,
  makeWrapper,
  copyDesktopItems,
  makeDesktopItem,
  electron,
  libuv,
  # Reuse the daemon's prebuilt npm-deps FOD. Same lockfile, same content —
  # without this, the desktop drv produces a separately-named store path
  # (`paseo-desktop-<v>-npm-deps`) and refetches the entire registry. Override
  # the upstream hash via `paseo.override { npmDepsHash = "..."; }`.
  paseo,
}:
buildNpmPackage {
  pname = "paseo-desktop";
  version = (builtins.fromJSON (builtins.readFile ../package.json)).version;

  src = lib.cleanSourceWith {
    src = ./..;
    filter = path: type: let
      baseName = builtins.baseNameOf path;
      relPath = lib.removePrefix (toString ./..) path;
    in
      # Exclude mobile-only platform code (we only need the web/electron build)
      !(lib.hasPrefix "/packages/app/android" relPath)
      && !(lib.hasPrefix "/packages/app/ios" relPath)
      # Website is unrelated to the desktop app
      && !(lib.hasPrefix "/packages/website" relPath)
      # Test fixtures and build artifacts
      && !(lib.hasSuffix ".test.ts" baseName)
      && !(lib.hasSuffix ".e2e.test.ts" baseName)
      && baseName != "node_modules"
      && baseName != ".git"
      && baseName != ".paseo"
      && baseName != ".DS_Store"
      && baseName != "release";
  };

  nodejs = nodejs_22;
  inherit (paseo) npmDeps;

  # Prevent onnxruntime-node's install script from running during automatic
  # npm rebuild. We manually rebuild only node-pty in buildPhase.
  npmRebuildFlags = ["--ignore-scripts"];

  nativeBuildInputs =
    [
      python3 # for node-gyp (node-pty)
    ]
    ++ lib.optionals stdenv.hostPlatform.isLinux [
      makeWrapper
      copyDesktopItems
    ];

  buildInputs = lib.optionals stdenv.hostPlatform.isLinux [libuv];

  dontNpmBuild = true;

  env = {
    EXPO_NO_TELEMETRY = "1";
    # Expo's web build pulls in some pre-bundled assets; ensure it doesn't try
    # to phone home during the build.
    CI = "1";
  };

  buildPhase = ''
    runHook preBuild

    # Native deps (terminal emulation; libuv-linked on Linux)
    npm rebuild node-pty

    # Server workspaces (highlight + relay + protocol + client + server + cli)
    npm run build:server

    # App workspace deps not covered by build:server
    npm run build --workspace=@getpaseo/expo-two-way-audio

    # Expo web export for the Electron renderer
    ( cd packages/app && PASEO_WEB_PLATFORM=electron npx expo export --platform web )

    # Desktop main process
    npm run build:main --workspace=@getpaseo/desktop

    ${lib.optionalString stdenv.hostPlatform.isDarwin ''
      # Let electron-builder create the native bundle layout (including helper
      # app names and bundle identifiers), but source Electron from nixpkgs
      # instead of downloading a release at build time.
      (
        cd packages/desktop
        CSC_IDENTITY_AUTO_DISCOVERY=false \
          ../../node_modules/.bin/electron-builder \
            --config electron-builder.yml \
            --dir \
            --mac \
            --publish never \
            --config.electronDist=${electron}/Applications \
            --config.mac.notarize=false
      )
    ''}

    runHook postBuild
  '';

  installPhase = ''
    runHook preInstall

    mkdir -p $out/bin

    ${lib.optionalString stdenv.hostPlatform.isLinux ''
      mkdir -p $out/share/paseo-desktop

      # Preserve the monorepo layout so main.js's dev-mode path resolution
      # (`__dirname/../../app/dist`, `__dirname/../assets/icon.png`) works
      # without patching: invoked unpackaged via `electron path/to/main.js`,
      # `app.isPackaged` is false, so these relative paths are used.
      #
      # Copy the entire packages/ tree (not just built artifacts) because npm
      # creates workspace symlinks from node_modules/@getpaseo/* into packages/*.
      # Missing any workspace package leaves dangling symlinks and fails the
      # noBrokenSymlinks output check. The cleanSourceWith filter above already
      # drops the big platform-specific things (android/ios, website, tests).
      cp package.json $out/share/paseo-desktop/
      cp -a packages $out/share/paseo-desktop/
      cp -a node_modules $out/share/paseo-desktop/

      # Skills directory referenced at runtime by some agents
      if [ -d skills ]; then
        cp -a skills $out/share/paseo-desktop/
      fi

      # Hicolor icon for desktop environments
      install -Dm644 packages/desktop/assets/icon.png \
        $out/share/icons/hicolor/512x512/apps/paseo-desktop.png

      # Chromium's setuid sandbox cannot live in the immutable Nix store.
      makeWrapper ${electron}/bin/electron $out/bin/paseo-desktop \
        --add-flags "$out/share/paseo-desktop/packages/desktop/dist/main.js" \
        --add-flags "--no-sandbox" \
        --set EXPO_DEV_URL "paseo://app/"

      copyDesktopItems
    ''}

    ${lib.optionalString stdenv.hostPlatform.isDarwin ''
      app="$(find packages/desktop/release -maxdepth 3 -type d -name Paseo.app -print -quit)"
      if [ -z "$app" ]; then
        echo "electron-builder did not produce Paseo.app" >&2
        exit 1
      fi
      mkdir -p "$out/Applications"
      cp -R "$app" "$out/Applications/Paseo.app"
      ln -s ../Applications/Paseo.app/Contents/MacOS/Paseo "$out/bin/paseo-desktop"
    ''}

    runHook postInstall
  '';

  desktopItems = lib.optionals stdenv.hostPlatform.isLinux [
    (makeDesktopItem {
      name = "paseo-desktop";
      desktopName = "Paseo";
      genericName = "AI Coding Agents";
      comment = "Self-hosted daemon for AI coding agents";
      exec = "paseo-desktop";
      icon = "paseo-desktop";
      categories = ["Development"];
      startupWMClass = "Paseo";
    })
  ];

  meta = {
    description = "Paseo desktop app (Electron wrapper)";
    homepage = "https://github.com/getpaseo/paseo";
    license = lib.licenses.agpl3Plus;
    mainProgram = "paseo-desktop";
    platforms = lib.platforms.linux ++ lib.platforms.darwin;
  };
}

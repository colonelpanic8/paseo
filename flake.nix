{
  description = "Paseo - self-hosted daemon for AI coding agents";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
  };

  outputs =
    {
      self,
      nixpkgs,
    }:
    let
      supportedSystems = [
        "x86_64-linux"
        "aarch64-linux"
        "x86_64-darwin"
        "aarch64-darwin"
      ];
      forAllSystems = nixpkgs.lib.genAttrs supportedSystems;
      pkgsFor = system: import nixpkgs { inherit system; };

      # Where a built commit is reachable from. This fork publishes its
      # assembled branch to its own repository, so that — not upstream — is
      # what `self.rev` refers to and what the commit links must point at.
      buildRepoUrl = "https://github.com/colonelpanic8/paseo";

      # `self.rev` exists only when the flake source is a clean git tree; a
      # dirty local checkout has `dirtyRev` instead, and a tarball source has
      # neither. nix/build-info.nix drops the whole stamp when there is no
      # commit, so `null` degrades cleanly to "no provenance reported".
      buildCommit = self.rev or self.dirtyRev or null;

      # `lastModifiedDate` is HEAD's commit date in UTC as YYYYMMDDHHMMSS.
      # (For a dirty tree it is the checkout's mtime — the best available
      # answer when there is no commit to take a date from.)
      buildCommitDate =
        let
          raw = self.lastModifiedDate or null;
          at = start: len: builtins.substring start len raw;
        in
        if raw == null || builtins.stringLength raw != 14 then
          null
        else
          "${at 0 4}-${at 4 2}-${at 6 2}T${at 8 2}:${at 10 2}:${at 12 2}Z";

      buildInfoArgs = { inherit buildCommit buildCommitDate buildRepoUrl; };
    in
    {
      packages = forAllSystems (
        system:
        let
          pkgs = pkgsFor system;
          paseo = pkgs.callPackage ./nix/package.nix buildInfoArgs;
          versionParts = pkgs.lib.splitString "." paseo.version;
          sourceRevision = if self ? revCount && self.revCount != null then self.revCount else 0;
          buildRevision = sourceRevision - (sourceRevision / 10000) * 10000;
          desktopBuildVersion = pkgs.lib.concatStringsSep "." [
            (builtins.elemAt versionParts 0)
            (builtins.elemAt versionParts 1)
            (toString buildRevision)
          ];
        in
        {
          default = paseo;
          paseo = paseo;
          desktop = pkgs.callPackage ./nix/desktop-package.nix (
            buildInfoArgs
            // {
              inherit paseo;
              buildVersion = desktopBuildVersion;
            }
          );
        }
      );

      nixosModules.default = self.nixosModules.paseo;
      nixosModules.paseo =
        { pkgs, lib, ... }:
        {
          imports = [ ./nix/module.nix ];
          services.paseo.package = lib.mkDefault self.packages.${pkgs.stdenv.hostPlatform.system}.default;
        };

      devShells = forAllSystems (
        system:
        let
          pkgs = pkgsFor system;
        in
        {
          default = pkgs.mkShell {
            packages = [
              pkgs.nodejs_22
              pkgs.python3
            ];
          };
        }
      );
    };
}

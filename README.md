# Codex banked reset QA

Implementation commit: 5422634c6.

Browser coverage: nine distinct settings cases passed across the logged focused runs. `browser.log` has seven passing cases. `browser-extra.log` adds the usage-refresh-failure case; its narrow-screen navigation failure is resolved in `browser-final.log`, which passes the narrow-screen and cleaned error/retry cases.

The browser uses the real Paseo application and an isolated daemon. Usage and redemption RPC responses are fixtures; no real reset was spent. Separate live read-only checks successfully parsed the Codex usage and reset-list endpoints.

NixOS harness: unset inherited PASEO_PASSWORD for the test process and override Playwright launchOptions.executablePath with /run/current-system/sw/bin/google-chrome in an untracked local config. The normal repository command is npm run test:e2e --workspace=@getpaseo/app -- e2e/browser/provider-usage-settings.spec.ts.

Provider/service tests: 10 passing. Provider session tests: 13 passing. Client tests: 2 passing. Protocol tests: 3 passing. Full-workspace typecheck, lint and formatting pass. Native iOS/Android and Electron were not exercised.

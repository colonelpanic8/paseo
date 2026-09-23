import { describe, expect, it } from "vitest";

const {
  addAssistantProvider,
  addEvaExtensionService,
  assistantProviderAuthority,
  setDebugCallerOptIn,
} = require("./with-assistant-provider");

describe("withAssistantProvider", () => {
  it("uses one authority for release builds and a private one for debug", () => {
    expect(assistantProviderAuthority("sh.paseo")).toBe("sh.paseo.assistant");
    expect(assistantProviderAuthority("sh.paseo.assembly")).toBe("sh.paseo.assistant");
    expect(assistantProviderAuthority("sh.paseo.debug")).toBe("sh.paseo.debug.assistant");
  });

  it("declares the exported provider on the application exactly once", () => {
    const manifest = {
      manifest: { application: [{ $: { "android:name": ".MainApplication" } }] },
    };

    const once = addAssistantProvider(manifest, "sh.paseo");
    const twice = addAssistantProvider(once, "sh.paseo");

    expect(twice.manifest.application[0].provider).toEqual([
      {
        $: {
          "android:name": "sh.paseo.androidintents.AssistantContentProvider",
          "android:authorities": "sh.paseo.assistant",
          "android:exported": "true",
          "android:grantUriPermissions": "false",
        },
      },
    ]);
  });

  it("advertises exactly one EVA extension service", () => {
    const manifest = {
      manifest: { application: [{ $: { "android:name": ".MainApplication" } }] },
    };

    const twice = addEvaExtensionService(addEvaExtensionService(manifest));

    expect(twice.manifest.application[0].service).toEqual([
      {
        $: {
          "android:name": "sh.paseo.androidintents.EvaExtensionService",
          "android:exported": "true",
        },
        "intent-filter": [
          { action: [{ $: { "android:name": "com.colonelpanic.eva.action.EXTENSION" } }] },
        ],
        "meta-data": [
          { $: { "android:name": "com.colonelpanic.eva.extension.version", "android:value": "1" } },
        ],
      },
    ]);
  });

  it("trusts debug EVA in a release build only when the build opts in", () => {
    const manifest = () => ({
      manifest: { application: [{ $: { "android:name": ".MainApplication" } }] },
    });
    const optedIn = setDebugCallerOptIn(manifest(), true);

    expect(setDebugCallerOptIn(manifest(), false).manifest.application[0]["meta-data"]).toEqual([]);
    expect(optedIn.manifest.application[0]["meta-data"]).toEqual([
      { $: { "android:name": "sh.paseo.assistant.allowDebugCallers", "android:value": "true" } },
    ]);
    expect(setDebugCallerOptIn(optedIn, false).manifest.application[0]["meta-data"]).toEqual([]);
  });
});

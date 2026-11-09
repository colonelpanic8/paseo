const { AndroidConfig, withAndroidManifest } = require("expo/config-plugins");

const PROVIDER_CLASS = "sh.paseo.androidintents.AssistantContentProvider";
const RELEASE_AUTHORITY = "sh.paseo.assistant";
const EVA_SERVICE_CLASS = "sh.paseo.androidintents.EvaExtensionService";
const EVA_EXTENSION_ACTION = "com.colonelpanic.eva.action.EXTENSION";
const EVA_EXTENSION_VERSION = "com.colonelpanic.eva.extension.version";
const ALLOW_DEBUG_CALLERS = "sh.paseo.assistant.allowDebugCallers";

// Assistants pin the release authority. A debug build gets its own so it can
// install beside a release build; Android refuses two apps with one authority.
function assistantProviderAuthority(packageName) {
  return packageName.endsWith(".debug") ? `${packageName}.assistant` : RELEASE_AUTHORITY;
}

function addAssistantProvider(androidManifest, packageName) {
  const application = AndroidConfig.Manifest.getMainApplicationOrThrow(androidManifest);
  const providers = (application.provider ?? []).filter(
    (item) => item.$?.["android:name"] !== PROVIDER_CLASS,
  );
  providers.push({
    $: {
      "android:name": PROVIDER_CLASS,
      "android:authorities": assistantProviderAuthority(packageName),
      "android:exported": "true",
      "android:grantUriPermissions": "false",
    },
  });
  application.provider = providers;
  return androidManifest;
}

// EVA discovers installed extensions by this action and binds the one
// exported service per package that advertises protocol version 1.
function addEvaExtensionService(androidManifest) {
  const application = AndroidConfig.Manifest.getMainApplicationOrThrow(androidManifest);
  const services = (application.service ?? []).filter(
    (item) => item.$?.["android:name"] !== EVA_SERVICE_CLASS,
  );
  services.push({
    $: { "android:name": EVA_SERVICE_CLASS, "android:exported": "true" },
    "intent-filter": [{ action: [{ $: { "android:name": EVA_EXTENSION_ACTION } }] }],
    "meta-data": [{ $: { "android:name": EVA_EXTENSION_VERSION, "android:value": "1" } }],
  });
  application.service = services;
  return androidManifest;
}

// Debuggable builds already accept a same-signer debug EVA. This lets a
// release build made for an isolated device test do the same; production
// builds never set PASEO_ASSISTANT_DEBUG_CALLERS.
function setDebugCallerOptIn(androidManifest, enabled) {
  const application = AndroidConfig.Manifest.getMainApplicationOrThrow(androidManifest);
  const metaData = (application["meta-data"] ?? []).filter(
    (item) => item.$?.["android:name"] !== ALLOW_DEBUG_CALLERS,
  );
  if (enabled) {
    metaData.push({ $: { "android:name": ALLOW_DEBUG_CALLERS, "android:value": "true" } });
  }
  application["meta-data"] = metaData;
  return androidManifest;
}

function withAssistantProvider(config) {
  return withAndroidManifest(config, (modConfig) => {
    const packageName = modConfig.android?.package;
    if (!packageName) {
      throw new Error("The assistant provider requires android.package");
    }
    modConfig.modResults = setDebugCallerOptIn(
      addEvaExtensionService(addAssistantProvider(modConfig.modResults, packageName)),
      process.env.PASEO_ASSISTANT_DEBUG_CALLERS === "1",
    );
    return modConfig;
  });
}

module.exports = withAssistantProvider;
module.exports.addAssistantProvider = addAssistantProvider;
module.exports.addEvaExtensionService = addEvaExtensionService;
module.exports.setDebugCallerOptIn = setDebugCallerOptIn;
module.exports.assistantProviderAuthority = assistantProviderAuthority;

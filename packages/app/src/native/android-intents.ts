import { requireOptionalNativeModule, type EventSubscription } from "expo-modules-core";

interface PaseoAndroidIntentsModule {
  consumeLaunchIntent(): unknown;
  setResumeShortcut(id: string, label: string, uri: string): void;
  clearDynamicShortcuts(): void;
  publishAssistantCatalog(json: string): void;
  resolveAssistantQuery(requestId: string, json: string): void;
  reportAssistantRequest(key: string, json: string): Promise<string | null>;
  finishAssistantRequest(key: string): void;
  isAssistantAutomationAllowed(): boolean;
  setAssistantAutomationAllowed(allowed: boolean): void;
  addListener(eventName: "onIntent", listener: (payload: unknown) => void): EventSubscription;
}

const nativeModule = requireOptionalNativeModule<PaseoAndroidIntentsModule>("PaseoAndroidIntents");

/**
 * Android-only bridge for intents Expo's linking layer cannot express: share
 * sheet payloads, PROCESS_TEXT selections, launcher shortcuts, and the catalog
 * the assistant content provider serves. Resolves to a no-op everywhere else.
 */
export const androidIntents = {
  isAvailable: nativeModule !== null,
  consumeLaunchIntent(): unknown {
    return nativeModule?.consumeLaunchIntent() ?? null;
  },
  addIntentListener(listener: (payload: unknown) => void): EventSubscription | null {
    return nativeModule?.addListener("onIntent", listener) ?? null;
  },
  setResumeShortcut(input: { id: string; label: string; uri: string }): void {
    nativeModule?.setResumeShortcut(input.id, input.label, input.uri);
  },
  clearDynamicShortcuts(): void {
    nativeModule?.clearDynamicShortcuts();
  },
  publishAssistantCatalog(json: string): void {
    nativeModule?.publishAssistantCatalog(json);
  },
  resolveAssistantQuery(requestId: string, json: string): void {
    nativeModule?.resolveAssistantQuery(requestId, json);
  },
  /** Resolves with the request as the journal now stores it. */
  async reportAssistantRequest(key: string, json: string): Promise<unknown> {
    if (!nativeModule) throw new Error("Assistant requests need the Android app");
    const stored = await nativeModule.reportAssistantRequest(key, json);
    return stored ? (JSON.parse(stored) as unknown) : null;
  },
  finishAssistantRequest(key: string): void {
    nativeModule?.finishAssistantRequest(key);
  },
  isAssistantAutomationAllowed(): boolean {
    return nativeModule?.isAssistantAutomationAllowed() ?? false;
  },
  setAssistantAutomationAllowed(allowed: boolean): void {
    nativeModule?.setAssistantAutomationAllowed(allowed);
  },
};

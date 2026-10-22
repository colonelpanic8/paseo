import { useEffect } from "react";
import { androidIntents } from "@/native/android-intents";
import { getHostRuntimeStore, useHosts } from "@/runtime/host-runtime";
import { useSessionStore } from "@/stores/session-store";
import { buildAssistantCatalog, type AssistantCatalogHost } from "./assistant-catalog";

const PUBLISH_DEBOUNCE_MS = 1500;

function collectCatalogJson(): string {
  const runtime = getHostRuntimeStore();
  const hosts: AssistantCatalogHost[] = runtime.getHosts().map((host) => ({
    serverId: host.serverId,
    label: host.label,
    status: runtime.getSnapshot(host.serverId)?.connectionStatus ?? "idle",
  }));
  const sessions = useSessionStore.getState().sessions;
  const workspaceServerIds = new Map<object, string>();
  const projects = [];
  const workspaces = [];
  const agents = [];
  for (const session of Object.values(sessions)) {
    for (const workspace of session.workspaces.values()) {
      workspaceServerIds.set(workspace, session.serverId);
      workspaces.push(workspace);
    }
    projects.push(
      ...[...session.projects.values()].map((project) => ({ serverId: session.serverId, project })),
    );
    agents.push(...session.agents.values());
  }
  return JSON.stringify(
    buildAssistantCatalog({
      now: new Date(),
      hosts,
      projects,
      workspaces,
      agents,
      serverIdOfWorkspace: (workspace) => workspaceServerIds.get(workspace) ?? "",
    }),
  );
}

/**
 * Publishes the bounded host/project/workspace/agent catalog the assistant content
 * provider serves, so an assistant can list and pick targets without waking
 * React Native. Debounced: the session store changes on every stream
 * tick, the catalog only when names, statuses, or membership do.
 */
export function AndroidAssistantCatalogSync() {
  const hosts = useHosts();
  useEffect(() => {
    if (!androidIntents.isAvailable) return;
    const runtime = getHostRuntimeStore();
    const releases = hosts.map((host) => runtime.acquireDirectoryDemand(host.serverId));
    return () => releases.forEach((release) => release());
  }, [hosts]);

  useEffect(() => {
    if (!androidIntents.isAvailable) {
      return;
    }
    let timer: ReturnType<typeof setTimeout> | null = null;
    let lastPublished: string | null = null;
    const publish = () => {
      timer = null;
      const json = collectCatalogJson();
      if (json === lastPublished) {
        return;
      }
      lastPublished = json;
      androidIntents.publishAssistantCatalog(json);
    };
    const schedule = () => {
      if (timer !== null) {
        return;
      }
      timer = setTimeout(publish, PUBLISH_DEBOUNCE_MS);
    };
    const unsubscribeSessions = useSessionStore.subscribe(schedule);
    const unsubscribeHosts = getHostRuntimeStore().subscribeAll(schedule);
    schedule();
    return () => {
      if (timer !== null) {
        clearTimeout(timer);
      }
      unsubscribeSessions();
      unsubscribeHosts();
    };
  }, []);

  return null;
}

import { describe, expect, it } from "vitest";
import {
  type CollapsedProjectsState,
  isStatusGroupCollapsed,
  mergePersistedCollapsedProjects,
  serializeCollapsedProjects,
  setProjectCollapsed,
  togglePinnedCollapsed,
  toggleProjectCollapsed,
  toggleWorkspaceGroupCollapsed,
} from "@/stores/sidebar-collapsed-sections-store/state";

function emptyState(): CollapsedProjectsState {
  return {
    collapsedProjectKeys: new Set(),
    collapsedWorkspaceGroupKeys: new Set(),
    collapsedPinned: false,
  };
}

describe("sidebar collapsed projects transitions", () => {
  it("tracks collapsed project keys as a Set", () => {
    let state = emptyState();

    state = setProjectCollapsed(state, "project-a", true);
    state = toggleProjectCollapsed(state, "project-b");
    state = toggleProjectCollapsed(state, "project-a");
    state = toggleWorkspaceGroupCollapsed(state, "running");

    expect(Array.from(state.collapsedProjectKeys)).toEqual(["project-b"]);
    expect(Array.from(state.collapsedWorkspaceGroupKeys)).toEqual(["running"]);
  });

  it("serializes collapsed project keys for preference storage", () => {
    const state: CollapsedProjectsState = {
      collapsedProjectKeys: new Set(["project-a", "project-b"]),
      collapsedWorkspaceGroupKeys: new Set(["running"]),
      collapsedPinned: true,
    };

    expect(serializeCollapsedProjects(state)).toEqual({
      collapsedProjectKeys: ["project-a", "project-b"],
      collapsedWorkspaceGroupKeys: ["running"],
      collapsedPinned: true,
    });
  });

  it("toggles and restores the pinned section collapse flag", () => {
    const toggled = togglePinnedCollapsed(emptyState());
    expect(toggled.collapsedPinned).toBe(true);

    const restored = mergePersistedCollapsedProjects({ collapsedPinned: true }, emptyState());
    expect(restored.collapsedPinned).toBe(true);
  });

  it("rejects the complete value when a persisted project key is invalid", () => {
    const restored = mergePersistedCollapsedProjects(
      { collapsedProjectKeys: ["project-a", "project-b", 42] },
      emptyState(),
    );

    expect(Array.from(restored.collapsedProjectKeys)).toEqual([]);
    expect(Array.from(restored.collapsedWorkspaceGroupKeys)).toEqual([]);
  });

  it("keeps the existing state object when persisted preferences do not change collapsed keys", () => {
    const currentState = emptyState();

    expect(mergePersistedCollapsedProjects(undefined, currentState)).toBe(currentState);
    expect(mergePersistedCollapsedProjects({}, currentState)).toBe(currentState);
    expect(mergePersistedCollapsedProjects({ collapsedProjectKeys: [] }, currentState)).toBe(
      currentState,
    );
  });
});

describe("isStatusGroupCollapsed", () => {
  it("treats key presence as collapsed for normal status groups", () => {
    expect(isStatusGroupCollapsed(new Set(), "running")).toBe(false);
    expect(isStatusGroupCollapsed(new Set(["running"]), "running")).toBe(true);
  });

  it("collapses the snoozed group by default and inverts the stored key to mean expanded", () => {
    expect(isStatusGroupCollapsed(new Set(), "snoozed")).toBe(true);
    expect(isStatusGroupCollapsed(new Set(["snoozed"]), "snoozed")).toBe(false);
  });

  it("toggling the snoozed group expands it and toggling again re-collapses it", () => {
    let state = emptyState();

    state = toggleStatusGroupCollapsed(state, "snoozed");
    expect(isStatusGroupCollapsed(state.collapsedStatusGroupKeys, "snoozed")).toBe(false);

    state = toggleStatusGroupCollapsed(state, "snoozed");
    expect(isStatusGroupCollapsed(state.collapsedStatusGroupKeys, "snoozed")).toBe(true);
  });

  it("keeps snoozed collapsed by default for persisted state that predates the bucket", () => {
    const restored = mergePersistedCollapsedProjects(
      { collapsedStatusGroupKeys: ["running"] },
      emptyState(),
    );

    expect(isStatusGroupCollapsed(restored.collapsedStatusGroupKeys, "running")).toBe(true);
    expect(isStatusGroupCollapsed(restored.collapsedStatusGroupKeys, "snoozed")).toBe(true);
  });
});

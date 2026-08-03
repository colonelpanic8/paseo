import { describe, expect, it } from "vitest";
import type { CommandCenterContribution, CommandCenterRegistrationOwner } from "./contributions";
import { createCommandCenterRegistry, getResolvableShortcutIds } from "./registry";

function action(
  id: string,
  rank: number,
  shortcutId?: string,
  run: () => void = () => undefined,
): CommandCenterContribution {
  return {
    id,
    ...(shortcutId ? { shortcutId } : {}),
    group: "actions",
    groupRank: 0,
    rank,
    keywords: [],
    visibility: "always",
    run,
    presentation: { kind: "action", title: id },
  };
}

function owner(sourceId: string): CommandCenterRegistrationOwner {
  return { sourceId, token: Symbol(sourceId) };
}

describe("Command Center registry", () => {
  it("atomically replaces a source and preserves a no-op snapshot", () => {
    const registry = createCommandCenterRegistry();
    const source = owner("root");
    const first = [action("first", 0)];
    let notifications = 0;
    registry.subscribe(() => {
      notifications += 1;
    });

    registry.replace({ owner: source, contributions: first });
    const snapshot = registry.getSnapshot();
    registry.replace({ owner: source, contributions: first });
    expect(registry.getSnapshot()).toBe(snapshot);
    expect(notifications).toBe(1);

    registry.replace({ owner: source, contributions: [action("second", 0)] });
    expect(registry.getSnapshot().contributions.map((item) => item.id)).toEqual(["root:second"]);
    expect(notifications).toBe(2);
  });

  it("does not let stale cleanup remove a replacement owner", () => {
    const registry = createCommandCenterRegistry();
    const stale = owner("draft:tab");
    const current = owner("draft:tab");
    registry.replace({ owner: stale, contributions: [action("old", 0)] });
    registry.replace({ owner: current, contributions: [action("new", 0)] });

    registry.remove(stale);
    expect(registry.getSnapshot().contributions.map((item) => item.id)).toEqual(["draft:tab:new"]);
    registry.remove(current);
    expect(registry.getSnapshot().contributions).toEqual([]);
  });

  it("orders independently of registration order and rejects duplicate active ids", () => {
    const registry = createCommandCenterRegistry();
    registry.replace({ owner: owner("later"), contributions: [action("z", 2)] });
    registry.replace({ owner: owner("earlier"), contributions: [action("a", 1)] });
    expect(registry.getSnapshot().contributions.map((item) => item.id)).toEqual([
      "earlier:a",
      "later:z",
    ]);

    const duplicateOwner = owner("duplicate");
    expect(() =>
      registry.replace({
        owner: duplicateOwner,
        contributions: [action("same", 0), action("same", 1)],
      }),
    ).toThrow("Duplicate Command Center contribution id: duplicate:same");
  });

  it("runs one active contribution by stable identity", () => {
    const registry = createCommandCenterRegistry();
    const calls: string[] = [];
    registry.replace({
      owner: owner("agent:host:first"),
      contributions: [action("dynamic-model", 0, "models:codex:gpt", () => calls.push("gpt"))],
    });

    expect(registry.getSnapshot().contributions[0].id).toBe("agent:host:first:dynamic-model");
    expect(registry.runShortcut("models:codex:gpt")).toBe(true);
    expect(calls).toEqual(["gpt"]);
  });

  it("does not run unavailable or ambiguous targets", () => {
    const registry = createCommandCenterRegistry();
    const calls: string[] = [];
    registry.replace({
      owner: owner("agent:first"),
      contributions: [action("high", 0, "thinking:high", () => calls.push("first"))],
    });
    registry.replace({
      owner: owner("agent:second"),
      contributions: [action("high", 0, "thinking:high", () => calls.push("second"))],
    });

    expect(getResolvableShortcutIds(registry.getSnapshot().contributions)).toEqual([]);
    expect(registry.runShortcut("thinking:high")).toBe(false);
    expect(registry.runShortcut("thinking:low")).toBe(false);
    expect(calls).toEqual([]);
  });

  it("catalogs inactive mounted sources without making them executable", () => {
    const registry = createCommandCenterRegistry();
    const source = owner("agent:first");
    registry.replace({
      owner: source,
      contributions: [action("high", 0, "thinking:high")],
      enabled: false,
    });

    expect(registry.getSnapshot().contributions).toEqual([]);
    expect(registry.getSnapshot().shortcutCatalog.map((item) => item.shortcutId)).toEqual([
      "thinking:high",
    ]);
    expect(registry.runShortcut("thinking:high")).toBe(false);

    registry.remove(source);
    expect(registry.getSnapshot().shortcutCatalog).toEqual([]);
  });

  it("updates active resolution when a mounted source changes focus", () => {
    const registry = createCommandCenterRegistry();
    const source = owner("agent:first");
    const contributions = [action("high", 0, "thinking:high")];
    registry.replace({ owner: source, contributions, enabled: false });
    registry.replace({ owner: source, contributions, enabled: true });

    expect(getResolvableShortcutIds(registry.getSnapshot().contributions)).toEqual([
      "thinking:high",
    ]);
  });
});

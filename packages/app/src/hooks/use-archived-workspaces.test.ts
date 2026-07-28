import { describe, expect, it } from "vitest";
import {
  mergeArchivedWorkspaces,
  shouldRefreshArchivedWorkspaces,
  type ArchivedWorkspaceEntry,
} from "./use-archived-workspaces";

function entry(input: {
  serverId: string;
  workspaceId: string;
  archivedAt: string;
}): ArchivedWorkspaceEntry {
  return {
    workspaceKey: `${input.serverId}:${input.workspaceId}`,
    serverId: input.serverId,
    workspaceId: input.workspaceId,
    projectName: "repo",
    name: input.workspaceId,
    archivedAt: new Date(input.archivedAt),
  };
}

function hostSlice(serverId: string, count: number): ArchivedWorkspaceEntry[] {
  const entries: ArchivedWorkspaceEntry[] = [];
  for (let index = 0; index < count; index += 1) {
    entries.push(
      entry({
        serverId,
        workspaceId: `${serverId}-${index}`,
        archivedAt: new Date(Date.UTC(2026, 2, 1, 0, index)).toISOString(),
      }),
    );
  }
  return entries;
}

describe("mergeArchivedWorkspaces", () => {
  it("interleaves hosts by archive time, newest first", () => {
    const merged = mergeArchivedWorkspaces([
      [
        entry({ serverId: "a", workspaceId: "a-old", archivedAt: "2026-03-01T00:00:00.000Z" }),
        entry({ serverId: "a", workspaceId: "a-new", archivedAt: "2026-03-05T00:00:00.000Z" }),
      ],
      [entry({ serverId: "b", workspaceId: "b-mid", archivedAt: "2026-03-03T00:00:00.000Z" })],
    ]);

    expect(merged.map((item) => item.workspaceId)).toEqual(["a-new", "b-mid", "a-old"]);
  });

  it("ignores hosts that have not resolved yet", () => {
    const merged = mergeArchivedWorkspaces([
      undefined,
      [entry({ serverId: "b", workspaceId: "b-one", archivedAt: "2026-03-03T00:00:00.000Z" })],
      undefined,
    ]);

    expect(merged.map((item) => item.workspaceId)).toEqual(["b-one"]);
  });

  it("orders a cascade archive deterministically when timestamps tie", () => {
    const sameInstant = "2026-03-04T00:00:00.000Z";
    const forward = mergeArchivedWorkspaces([
      [
        entry({ serverId: "a", workspaceId: "child", archivedAt: sameInstant }),
        entry({ serverId: "a", workspaceId: "parent", archivedAt: sameInstant }),
      ],
    ]);
    const reversed = mergeArchivedWorkspaces([
      [
        entry({ serverId: "a", workspaceId: "parent", archivedAt: sameInstant }),
        entry({ serverId: "a", workspaceId: "child", archivedAt: sameInstant }),
      ],
    ]);

    expect(forward.map((item) => item.workspaceId)).toEqual(["child", "parent"]);
    expect(reversed.map((item) => item.workspaceId)).toEqual(forward.map((i) => i.workspaceId));
  });

  it("caps the merged tail so many hosts cannot grow it without bound", () => {
    const slices = ["a", "b", "c"].map((serverId) => hostSlice(serverId, 20));

    const merged = mergeArchivedWorkspaces(slices);

    expect(merged).toHaveLength(25);
    // Still the newest ones, not just the first host's slice.
    expect(new Set(merged.map((item) => item.serverId))).toEqual(new Set(["a", "b", "c"]));
  });
});

describe("shouldRefreshArchivedWorkspaces", () => {
  const cached = [
    entry({
      serverId: "a",
      workspaceId: "archived",
      archivedAt: "2026-03-03T00:00:00.000Z",
    }),
  ];

  it("refreshes when a workspace disappears from the live directory", () => {
    expect(shouldRefreshArchivedWorkspaces("remove", "newly-archived", cached)).toBe(true);
  });

  it("refreshes when a cached archived workspace returns to the live directory", () => {
    expect(shouldRefreshArchivedWorkspaces("upsert", "archived", cached)).toBe(true);
  });

  it("ignores ordinary updates to live workspaces", () => {
    expect(shouldRefreshArchivedWorkspaces("upsert", "live", cached)).toBe(false);
  });
});

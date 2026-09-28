import { describe, expect, it } from "vitest";
import { resolveCommandSource } from "./use-agent-autocomplete";

describe("resolveCommandSource", () => {
  it("keeps an incomplete draft off the session path", () => {
    expect(
      resolveCommandSource({
        serverId: "srv_1",
        agentId: "new-workspace",
        draft: { status: "needs-project" },
      }),
    ).toEqual({ kind: "draft-incomplete", missing: "project" });
    expect(
      resolveCommandSource({
        serverId: "srv_1",
        agentId: "new-workspace",
        draft: { status: "needs-provider" },
      }),
    ).toEqual({ kind: "draft-incomplete", missing: "provider" });
  });

  it("lists a ready draft by its config", () => {
    expect(
      resolveCommandSource({
        serverId: "srv_1",
        agentId: "new-workspace",
        draft: { status: "ready", config: { provider: "claude", cwd: " /repo ", model: "opus" } },
      }),
    ).toEqual({ kind: "draft", config: { provider: "claude", cwd: "/repo", model: "opus" } });
  });

  it("lists a running agent by its id", () => {
    expect(
      resolveCommandSource({ serverId: "srv_1", agentId: "agent-1", draft: undefined }),
    ).toEqual({ kind: "session" });
  });
});

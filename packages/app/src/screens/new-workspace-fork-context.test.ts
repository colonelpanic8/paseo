import { describe, expect, it } from "vitest";
import type { AgentAttachment } from "@getpaseo/protocol/messages";
import {
  createNativeForkInWorkspace,
  getWorkspaceNamingAttachments,
  remapDraftCwdToWorkspace,
} from "./new-workspace-fork-context";

describe("remapDraftCwdToWorkspace", () => {
  it("preserves a Windows subdirectory when source path casing differs", () => {
    expect(
      remapDraftCwdToWorkspace({
        cwd: "c:\\Repo\\packages\\app",
        sourceDirectory: "C:\\Repo",
        workspaceDirectory: "D:\\Worktrees\\fork",
      }),
    ).toBe("D:\\Worktrees\\fork\\packages\\app");
  });

  it("falls back to the workspace root when the cwd is outside the source directory", () => {
    expect(
      remapDraftCwdToWorkspace({
        cwd: "/other/repo/packages/app",
        sourceDirectory: "/repo",
        workspaceDirectory: "/worktrees/fork",
      }),
    ).toBe("/worktrees/fork");
  });
});

describe("getWorkspaceNamingAttachments", () => {
  it("removes full chat history from workspace naming context", () => {
    const chatHistory = {
      type: "text",
      mimeType: "text/plain",
      contextKind: "chat_history",
      title: "Chat history",
      text: "Long prior conversation",
    } satisfies AgentAttachment;
    const prContext = {
      type: "github_pr",
      mimeType: "application/github-pr",
      number: 1788,
      title: "Fork assistant turns into new drafts",
      url: "https://github.com/getpaseo/paseo/pull/1788",
    } satisfies AgentAttachment;

    expect(getWorkspaceNamingAttachments([chatHistory, prContext])).toEqual([prContext]);
  });
});

describe("createNativeForkInWorkspace", () => {
  it("creates an empty destination and imports native history into its remapped cwd", async () => {
    const createCalls: unknown[] = [];
    const forkCalls: unknown[] = [];

    const result = await createNativeForkInWorkspace({
      client: {
        forkAgentNative: async (agentId, options) => {
          forkCalls.push({ agentId, options });
          return {
            requestId: "request-1",
            agentId,
            forkedAgentId: "forked-agent",
            forkedWorkspaceId: "destination-workspace",
            error: null,
          };
        },
      },
      agentId: "source-agent",
      boundaryMessageId: "assistant-message",
      sourceCwd: "/repo/packages/app",
      sourceDirectory: "/repo",
      ensureWorkspace: async (options) => {
        createCalls.push(options);
        return {
          id: "destination-workspace",
          workspaceDirectory: "/worktrees/fork",
        };
      },
      failureMessage: "Fork failed",
    });

    expect(createCalls).toEqual([
      {
        cwd: "/repo/packages/app",
        prompt: "",
        attachments: [],
        withInitialAgent: false,
      },
    ]);
    expect(forkCalls).toEqual([
      {
        agentId: "source-agent",
        options: {
          boundaryMessageId: "assistant-message",
          workspaceId: "destination-workspace",
          cwd: "/worktrees/fork/packages/app",
        },
      },
    ]);
    expect(result).toEqual({
      agentId: "forked-agent",
      workspaceId: "destination-workspace",
    });
  });
});

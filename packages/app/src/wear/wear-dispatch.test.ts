import { describe, expect, it } from "vitest";

import { buildWearDispatchState } from "./wear-dispatch";

describe("buildWearDispatchState", () => {
  it("projects a configured target without exposing its ids", () => {
    expect(
      buildWearDispatchState({
        serverId: "srv-1",
        agentId: "agent-chief",
        label: "Chief of staff",
      }),
    ).toEqual({ configured: true, label: "Chief of staff" });
  });

  it("projects an unconfigured target and the latest explicit failure", () => {
    expect(
      buildWearDispatchState(null, {
        requestId: "request-1",
        status: "failure",
        message: "No dispatch agent set on your phone",
      }),
    ).toEqual({
      configured: false,
      result: {
        requestId: "request-1",
        status: "failure",
        message: "No dispatch agent set on your phone",
      },
    });
  });
});

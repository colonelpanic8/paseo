import { describe, expect, it } from "vitest";
import { parseDispatchLink } from "@/dispatch/dispatch-link";

describe("parseDispatchLink", () => {
  it("parses the bare dispatch link", () => {
    expect(parseDispatchLink("paseo://dispatch")).toEqual({ host: null, agent: null });
    expect(parseDispatchLink("paseo://dispatch/")).toEqual({ host: null, agent: null });
  });

  it("parses an explicit host and agent", () => {
    expect(parseDispatchLink("paseo://dispatch?host=host%2Fa&agent=agent-1")).toEqual({
      host: "host/a",
      agent: "agent-1",
    });
  });

  it("drops an agent that names no host", () => {
    expect(parseDispatchLink("paseo://dispatch?agent=agent-1")).toEqual({
      host: null,
      agent: null,
    });
  });

  it.each(["paseo://live-voice", "paseo://dispatch/now", "https://dispatch", "nope"])(
    "rejects %s",
    (url) => {
      expect(parseDispatchLink(url)).toBeNull();
    },
  );
});

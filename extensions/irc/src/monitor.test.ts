import { describe, expect, it } from "vitest";
import { resolveIrcInboundTarget } from "./monitor.js";

describe("irc monitor inbound target", () => {
  it("keeps channel target for group messages", () => {
    expect(
      resolveIrcInboundTarget({
        target: "#foxfang",
        senderNick: "alice",
      }),
    ).toEqual({
      isGroup: true,
      target: "#foxfang",
      rawTarget: "#foxfang",
    });
  });

  it("maps DM target to sender nick and preserves raw target", () => {
    expect(
      resolveIrcInboundTarget({
        target: "foxfang-bot",
        senderNick: "alice",
      }),
    ).toEqual({
      isGroup: false,
      target: "alice",
      rawTarget: "foxfang-bot",
    });
  });

  it("falls back to raw target when sender nick is empty", () => {
    expect(
      resolveIrcInboundTarget({
        target: "foxfang-bot",
        senderNick: " ",
      }),
    ).toEqual({
      isGroup: false,
      target: "foxfang-bot",
      rawTarget: "foxfang-bot",
    });
  });
});

import { describe, expect, it } from "vitest";
import { shortenText } from "./text-format.js";

describe("shortenText", () => {
  it("returns original text when it fits", () => {
    expect(shortenText("foxfang", 16)).toBe("foxfang");
  });

  it("truncates and appends ellipsis when over limit", () => {
    expect(shortenText("foxfang-status-output", 10)).toBe("foxfang-…");
  });

  it("counts multi-byte characters correctly", () => {
    expect(shortenText("hello🙂world", 7)).toBe("hello🙂…");
  });
});

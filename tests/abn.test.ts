import { describe, it, expect } from "vitest";
import { isValidAbn, formatAbn } from "../lib/abn";

describe("ABN checksum", () => {
  it("accepts known-valid ABNs", () => {
    expect(isValidAbn("51824753556")).toBe(true); // ATO's published example
    expect(isValidAbn("51 824 753 556")).toBe(true);
  });
  it("rejects invalid ABNs", () => {
    expect(isValidAbn("51824753557")).toBe(false);
    expect(isValidAbn("12345678901")).toBe(false);
    expect(isValidAbn("1234")).toBe(false);
    expect(isValidAbn("")).toBe(false);
  });
  it("formats", () => {
    expect(formatAbn("51824753556")).toBe("51 824 753 556");
  });
});

import { describe, expect, it } from "vitest";
import { parseYoloText, validateYoloText } from "../src/lib/tiling";

describe("YOLO annotation validation", () => {
  it("reports line numbers and rejects malformed values without remapping classes", () => {
    const text = [
      "2 0.5 0.5 0.2 0.2",
      "2junk 0.5 0.5 0.2 0.2",
      "6 0.5 NaN 0.2 0.2",
      "10 0.5 0.5 0.2 0.2",
      "6 0.5 0.5 -0.2 0.2",
      "6 1.1 0.5 0.2 0.2",
      "6 0.5 0.5 0.2",
    ].join("\n");
    expect(validateYoloText(text, 10).map((issue) => issue.lineNumber)).toEqual([2, 3, 4, 5, 6, 7]);
    expect(() => parseYoloText(text)).toThrow(/line 2/i);
  });

  it("accepts boundary rounding in six-decimal source annotations", () => {
    expect(validateYoloText("6 0.009359 0.210052 0.018719 0.054813", 10)).toEqual([]);
  });
});

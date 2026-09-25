import { describe, expect, it } from "vitest";
import { formatSize } from "../src/lib/format-size";

describe("uploaded file sizes", () => {
  it("formats bytes, kilobytes, and megabytes", () => {
    expect(formatSize(1023)).toBe("1023 B");
    expect(formatSize(1024)).toBe("1.0 KB");
    expect(formatSize(1024 * 1024)).toBe("1.0 MB");
    expect(formatSize(2.5 * 1024 * 1024)).toBe("2.5 MB");
  });
});

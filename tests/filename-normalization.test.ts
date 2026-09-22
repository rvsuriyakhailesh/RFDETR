import { describe, expect, it } from "vitest";
import { normalizeNumericFilenames } from "../src/lib/filename-normalization";

describe("numeric filename normalization", () => {
  it("pads the current dataset's images and annotations identically", () => {
    const stems = ["01", "02", "10", "11", "99", "100", "101", "110"];
    const expected = ["001", "002", "010", "011", "099", "100", "101", "110"];
    const result = normalizeNumericFilenames(stems.map(n => `${n}.jpg`), stems.map(n => `${n}.txt`));
    expect(result.imageNames).toEqual(expected.map(n => `${n}.jpg`));
    expect(result.annotationNames).toEqual(expected.map(n => `${n}.txt`));
    expect(result.issues).toEqual([]);
  });

  it.each([
    [["image01.jpg"], ["image01.txt"]],
    [["01.jpg", "02.jpg", "camera03.jpg"], ["01.txt", "02.txt", "camera03.txt"]],
    [["01.jpg"], ["01.txt", "camera03.txt"]],
    [["camera01.jpg"], ["01.txt"]],
  ])("leaves the entire dataset unchanged if either side is non-numeric", (images, annotations) => {
    const result = normalizeNumericFilenames(images, annotations);
    expect(result.imageNames).toBe(images);
    expect(result.annotationNames).toBe(annotations);
    expect(result.issues).toEqual([]);
  });

  it("uses four digits when needed", () => {
    const stems = ["1", "10", "100", "1000"];
    const result = normalizeNumericFilenames(stems.map(n => `${n}.jpg`), stems.map(n => `${n}.txt`));
    expect(result.imageNames).toEqual(["0001.jpg", "0010.jpg", "0100.jpg", "1000.jpg"]);
    expect(result.annotationNames).toEqual(["0001.txt", "0010.txt", "0100.txt", "1000.txt"]);
  });

  it("preserves extension spelling and pairs independently of entry order", () => {
    const result = normalizeNumericFilenames(
      ["01.jpg", "02.jpeg", "03.png", "04.JPG", "05.tiff", "06.bmp"],
      ["06.txt", "05.txt", "04.txt", "03.txt", "02.txt", "01.txt"],
    );
    expect(result.imageNames).toEqual(["001.jpg", "002.jpeg", "003.png", "004.JPG", "005.tiff", "006.bmp"]);
    expect(result.annotationNames).toEqual(["006.txt", "005.txt", "004.txt", "003.txt", "002.txt", "001.txt"]);
  });

  it.each([
    [["1.jpg", "01.jpg"], ["1.txt", "01.txt"]],
    [["01.jpg", "001.jpg"], ["01.txt", "001.txt"]],
    [["01.jpg", "01.png"], ["01.txt"]],
    [["01.jpg"], ["01.txt", "001.txt"]],
  ])("rejects collisions without applying any renames", (images, annotations) => {
    const result = normalizeNumericFilenames(images, annotations);
    expect(result.imageNames).toBe(images);
    expect(result.annotationNames).toBe(annotations);
    expect(result.issues.length).toBeGreaterThan(0);
    expect(result.issues[0].type).toBe("duplicate-filename");
    expect(result.issues[0].reason).toContain("No files were renamed");
  });

  it("does not silently repair unmatched original stems", () => {
    const result = normalizeNumericFilenames(["01.jpg"], ["1.txt"]);
    expect(result.imageNames).toEqual(["01.jpg"]);
    expect(result.annotationNames).toEqual(["1.txt"]);
  });

  it("handles zero, existing padding, and numeric stems beyond Number precision", () => {
    const stems = ["0", "0001", "900719925474099312345"];
    const result = normalizeNumericFilenames(stems.map(n => `${n}.png`), stems.map(n => `${n}.txt`));
    expect(result.imageNames).toEqual(stems.map(n => `${n.padStart(21, "0")}.png`));
    expect(normalizeNumericFilenames(result.imageNames, result.annotationNames)).toEqual(result);
  });

  it("leaves missing sides to the existing validation", () => {
    expect(normalizeNumericFilenames(["01.jpg"], []).imageNames).toEqual(["01.jpg"]);
    expect(normalizeNumericFilenames([], ["01.txt"]).annotationNames).toEqual(["01.txt"]);
  });
});

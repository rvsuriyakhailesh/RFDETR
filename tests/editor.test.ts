import { describe, expect, it } from "vitest";
import { imageNumberToIndex, moveSelectedBoxes } from "../src/lib/editor";
import { formatYoloLine, parseYoloText, type YoloLine } from "../src/lib/tiling";

describe("image-number navigation", () => {
  it("maps displayed positions to indices, including endpoints", () => {
    expect(imageNumberToIndex("1", 100)).toBe(0);
    expect(imageNumberToIndex(" 42 ", 100)).toBe(41);
    expect(imageNumberToIndex("100", 100)).toBe(99);
  });
  it.each(["", " ", "0", "-1", "101", "1.5", "2e1", "abc", "Infinity"])("rejects %j", (value) => {
    expect(imageNumberToIndex(value, 100)).toBeNull();
  });
  it("rejects navigation for an empty dataset", () => {
    expect(imageNumberToIndex("1", 0)).toBeNull();
  });
});

const boxes: YoloLine[] = [
  { cls: 0, xCenter: 0.2, yCenter: 0.3, width: 0.2, height: 0.2 },
  { cls: 1, xCenter: 0.7, yCenter: 0.6, width: 0.4, height: 0.2 },
  { cls: 2, xCenter: 0.5, yCenter: 0.5, width: 0.1, height: 0.1 },
];

describe("box movement", () => {
  it("moves one box without changing its size, class, or other boxes", () => {
    const result = moveSelectedBoxes(boxes, new Set([0]), 0.1, -0.1);
    expect(result[0].xCenter).toBeCloseTo(0.3);
    expect(result[0].yCenter).toBeCloseTo(0.2);
    expect(result[0]).toMatchObject({ cls: 0, width: 0.2, height: 0.2 });
    expect(result[1]).toBe(boxes[1]);
    expect(result[2]).toBe(boxes[2]);
    expect(boxes[0].xCenter).toBe(0.2);
  });
  it.each([[2, 2, 0.1, 0.3], [-2, -2, -0.1, -0.2]])(
    "clamps the entire group at the image boundary (%s, %s)", (dx, dy, actualX, actualY) => {
      const result = moveSelectedBoxes(boxes, new Set([0, 1]), dx, dy);
      for (const i of [0, 1]) {
        expect(result[i].xCenter - boxes[i].xCenter).toBeCloseTo(actualX);
        expect(result[i].yCenter - boxes[i].yCenter).toBeCloseTo(actualY);
        expect(result[i].width).toBe(boxes[i].width);
        expect(result[i].height).toBe(boxes[i].height);
        expect(result[i].cls).toBe(boxes[i].cls);
      }
      expect(result[1].xCenter - result[0].xCenter).toBeCloseTo(0.5);
      expect(result[1].yCenter - result[0].yCenter).toBeCloseTo(0.3);
      expect(result[2]).toBe(boxes[2]);
    },
  );
  it("computes each frame from the snapshot and preserves it for undo", () => {
    const snapshot = structuredClone(boxes);
    moveSelectedBoxes(boxes, new Set([0, 1]), 0.05, 0.02);
    const result = moveSelectedBoxes(boxes, new Set([0, 1]), 0.08, 0.04);
    expect(result[0].xCenter).toBeCloseTo(0.28);
    expect(boxes).toEqual(snapshot);
    expect(moveSelectedBoxes(boxes, new Set([0, 1]), 0, 0)).toBe(boxes);
  });
  it("round-trips moved annotations through the existing save format", () => {
    const result = moveSelectedBoxes(boxes, new Set([0, 1]), 0.05, -0.05);
    const reopened = parseYoloText(result.map((box) => formatYoloLine(box)).join("\n"));
    reopened.forEach((box, index) => {
      expect(box.xCenter).toBeCloseTo(result[index].xCenter, 6);
      expect(box.yCenter).toBeCloseTo(result[index].yCenter, 6);
      expect(box.cls).toBe(result[index].cls);
    });
  });
});

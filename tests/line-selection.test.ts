import { describe, expect, it } from "vitest";
import { pasteBoxesAtPosition, segmentCrossesRectInterior, selectBoxesCrossedByLine } from "../src/lib/editor";

const rect = { left: 0, top: 0, right: 10, bottom: 10 };
const point = (x: number, y: number) => ({ x, y });

describe("segmentCrossesRectInterior", () => {
  it.each([
    [point(-5, 5), point(15, 5)],
    [point(15, 5), point(-5, 5)],
    [point(5, -5), point(5, 15)],
    [point(5, 15), point(5, -5)],
    [point(-5, -5), point(15, 15)],
    [point(15, 15), point(-5, -5)],
    [point(5, 5), point(15, 5)],
    [point(-5, 5), point(5, 5)],
  ])("accepts a segment through the interior", (start, end) => {
    expect(segmentCrossesRectInterior(start, end, rect)).toBe(true);
  });

  it.each([
    [point(-5, 0), point(15, 0)],
    [point(-5, 10), point(15, 10)],
    [point(0, -5), point(0, 15)],
    [point(10, -5), point(10, 15)],
    [point(-5, 5), point(0, 5)],
    [point(15, 5), point(10, 5)],
    [point(5, -5), point(5, 0)],
    [point(5, 15), point(5, 10)],
    [point(-5, -5), point(0, 0)],
    [point(-5, 0), point(0, -5)],
    [point(5, 5), point(5, 5)],
  ])("rejects border contact or a zero-length line", (start, end) => {
    expect(segmentCrossesRectInterior(start, end, rect)).toBe(false);
  });
});

describe("line selection visibility", () => {
  const boxes = [
    { cls: 2, xCenter: 0.2, yCenter: 0.5, width: 0.1, height: 0.2 },
    { cls: 6, xCenter: 0.5, yCenter: 0.5, width: 0.1, height: 0.2 },
    { cls: 2, xCenter: 0.8, yCenter: 0.5, width: 0.1, height: 0.2 },
  ];
  const from = point(-0.1, 0.5);
  const to = point(1.1, 0.5);
  it("selects only visible classes", () => {
    expect([...selectBoxesCrossedByLine(boxes, from, to, (cls) => cls === 2)]).toEqual([0, 2]);
    expect([...selectBoxesCrossedByLine(boxes, from, to, (cls) => cls === 6)]).toEqual([1]);
    expect([...selectBoxesCrossedByLine(boxes, from, to, () => true)]).toEqual([0, 1, 2]);
    expect([...selectBoxesCrossedByLine(boxes, from, to, () => false)]).toEqual([]);
  });
});

describe("pasteBoxesAtPosition", () => {
  const box = { cls: 6, xCenter: 0.25, yCenter: 0.25, width: 0.2, height: 0.4 };
  it("centers a copy at the pointer and preserves class and size", () => {
    expect(pasteBoxesAtPosition([box], 0.7, 0.6)).toEqual([{ ...box, xCenter: 0.7, yCenter: 0.6 }]);
  });
  it("clamps the center near image borders", () => {
    expect(pasteBoxesAtPosition([box], 0.99, 0.01)).toEqual([{ ...box, xCenter: 0.9, yCenter: 0.2 }]);
  });
  it("preserves the spacing of a copied group", () => {
    const second = { ...box, cls: 2, xCenter: 0.55 };
    const pasted = pasteBoxesAtPosition([box, second], 0.7, 0.5)!;
    expect(pasted[1].xCenter - pasted[0].xCenter).toBeCloseTo(0.3);
    expect(pasted.map((item) => item.cls)).toEqual([6, 2]);
  });
});

import { describe, it, expect } from "vitest";
import {
  recomputeAnnotationForTile,
  parseYoloLine,
  formatYoloLine,
  TILE_0,
  TILE_1,
  IMAGE_WIDTH,
  IMAGE_HEIGHT,
  TILE_SIZE,
  type YoloLine,
} from "../src/lib/tiling";

function approxEqual(a: number, b: number, eps = 1e-4): boolean {
  return Math.abs(a - b) < eps;
}

function makeLine(
  cls: number,
  xc: number,
  yc: number,
  w: number,
  h: number,
): YoloLine {
  return { cls, xCenter: xc, yCenter: yc, width: w, height: h };
}

describe("recomputeAnnotationForTile", () => {
  it("box fully inside tile 0 — unchanged y, re-normalized x against tile", () => {
    // Box at pixel [200, 800] x [200, 400] => center 500,300 / size 600x200
    // normalized: xc=500/2560, yc=300/1440, w=600/2560, h=200/1440
    const line = makeLine(0, 500 / 2560, 300 / 1440, 600 / 2560, 200 / 1440);
    const result = recomputeAnnotationForTile(line, TILE_0);
    expect(result).not.toBeNull();
    expect(result!.cls).toBe(0);
    // x center in tile coords: 500 / 1440
    expect(approxEqual(result!.xCenter, 500 / 1440)).toBe(true);
    // width: 600 / 1440
    expect(approxEqual(result!.width, 600 / 1440)).toBe(true);
    // y unchanged: 300 / 1440
    expect(approxEqual(result!.yCenter, 300 / 1440)).toBe(true);
    expect(approxEqual(result!.height, 200 / 1440)).toBe(true);
  });

  it("box fully inside tile 1 — re-normalized against tile 1 offset", () => {
    // Box at pixel [1500, 2000] x [100, 1300] => center 1750,700 / size 500x1200
    const line = makeLine(0, 1750 / 2560, 700 / 1440, 500 / 2560, 1200 / 1440);
    const result = recomputeAnnotationForTile(line, TILE_1);
    expect(result).not.toBeNull();
    // tile 1 xMin = 1120, so center in tile = 1750-1120 = 630, /1440
    expect(approxEqual(result!.xCenter, 630 / 1440)).toBe(true);
    expect(approxEqual(result!.width, 500 / 1440)).toBe(true);
    expect(approxEqual(result!.yCenter, 700 / 1440)).toBe(true);
    expect(approxEqual(result!.height, 1200 / 1440)).toBe(true);
  });

  it("box fully outside both tiles — returns null for both", () => {
    // Box at pixel [-200, -50] (left of image, left of tile 0)
    // center = -125, top-left = -200, bottom-right = -50
    // xc = -125/2560, w = 150/2560
    const line = makeLine(1, -125 / 2560, 500 / 1440, 150 / 2560, 200 / 1440);
    const r0 = recomputeAnnotationForTile(line, TILE_0);
    const r1 = recomputeAnnotationForTile(line, TILE_1);
    expect(r0).toBeNull();
    expect(r1).toBeNull();
  });

  it("box straddling the seam — appears clipped in both tiles", () => {
    // Box at pixel [1300, 1700] x [100, 300] => center 1500,200 / size 400x200
    // straddles x=1440 (tile 0 right edge) and x=1120 (tile 1 left edge)
    const line = makeLine(2, 1500 / 2560, 200 / 1440, 400 / 2560, 200 / 1440);

    // Tile 0: clip [1300, 1440] => width 140, center 1370
    const r0 = recomputeAnnotationForTile(line, TILE_0);
    expect(r0).not.toBeNull();
    expect(approxEqual(r0!.xCenter, (1370 - 0) / 1440)).toBe(true);
    expect(approxEqual(r0!.width, 140 / 1440)).toBe(true);
    expect(approxEqual(r0!.yCenter, 200 / 1440)).toBe(true);
    expect(approxEqual(r0!.height, 200 / 1440)).toBe(true);
    expect(r0!.cls).toBe(2);

    // Tile 1: clip [1300, 1700] => width 400, center 1500, offset 1120 => 380
    const r1 = recomputeAnnotationForTile(line, TILE_1);
    expect(r1).not.toBeNull();
    expect(approxEqual(r1!.xCenter, (1500 - 1120) / 1440)).toBe(true);
    expect(approxEqual(r1!.width, 400 / 1440)).toBe(true);
    expect(approxEqual(r1!.yCenter, 200 / 1440)).toBe(true);
    expect(approxEqual(r1!.height, 200 / 1440)).toBe(true);
    expect(r1!.cls).toBe(2);
  });

  it("tiny sliver after clipping — kept, not dropped", () => {
    // Box at pixel [1430, 1450] x [100, 300] => 20px wide, straddles tile 0 right edge
    // Tile 0: clip [1430, 1440] => 10px sliver
    // Tile 1: clip [1120, 1450] => 330px
    const line = makeLine(3, 1440 / 2560, 200 / 1440, 20 / 2560, 200 / 1440);

    const r0 = recomputeAnnotationForTile(line, TILE_0);
    expect(r0).not.toBeNull();
    // sliver: 10px wide in tile 0
    expect(approxEqual(r0!.width, 10 / 1440)).toBe(true);
    expect(approxEqual(r0!.xCenter, (1435 - 0) / 1440)).toBe(true);

    const r1 = recomputeAnnotationForTile(line, TILE_1);
    expect(r1).not.toBeNull();
    // sliver in tile 1: clip [1430, 1450] => 20px
    expect(approxEqual(r1!.width, 20 / 1440)).toBe(true);
    expect(approxEqual(r1!.xCenter, (1440 - 1120) / 1440)).toBe(true);
  });

  it("box exactly at tile boundary — clip_right == clip_left returns null", () => {
    // Box right edge exactly at tile 0 left edge (x=0)
    // box at pixel [-200, 0] => center -100, width 200
    const line = makeLine(0, -100 / 2560, 500 / 1440, 200 / 2560, 200 / 1440);
    const r0 = recomputeAnnotationForTile(line, TILE_0);
    expect(r0).toBeNull();
  });

  it("round-trip parse/format preserves values", () => {
    const original = "5 0.123456 0.789012 0.345678 0.901234";
    const parsed = parseYoloLine(original);
    expect(parsed).not.toBeNull();
    const formatted = formatYoloLine({
      cls: parsed!.cls,
      xCenter: parsed!.xCenter,
      yCenter: parsed!.yCenter,
      width: parsed!.width,
      height: parsed!.height,
    });
    const reparsed = parseYoloLine(formatted);
    expect(reparsed).not.toBeNull();
    expect(approxEqual(reparsed!.xCenter, parsed!.xCenter, 1e-5)).toBe(true);
    expect(approxEqual(reparsed!.yCenter, parsed!.yCenter, 1e-5)).toBe(true);
    expect(approxEqual(reparsed!.width, parsed!.width, 1e-5)).toBe(true);
    expect(approxEqual(reparsed!.height, parsed!.height, 1e-5)).toBe(true);
  });

  it("preserves class index through recomputation", () => {
    const line = makeLine(7, 500 / 2560, 300 / 1440, 600 / 2560, 200 / 1440);
    const result = recomputeAnnotationForTile(line, TILE_0);
    expect(result!.cls).toBe(7);
  });
});

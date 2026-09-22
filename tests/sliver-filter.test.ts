import { afterEach, describe, expect, it, vi } from "vitest";
import { recomputeAnnotationForTile, TILE_0, parseYoloText } from "../src/lib/tiling";
import { runTiling } from "../src/lib/tiling-pipeline";
import { computeSplitData } from "../src/components/SplitPicker";
import { DEFAULT_SMALL_BOX_THRESHOLD, sanitizeSliverValue } from "../src/lib/tiling-settings";

const box = (w: number, h: number, left = 200, top = 200) => ({
  cls: 1, xCenter: (left + w / 2) / 2560, yCenter: (top + h / 2) / 1440,
  width: w / 2560, height: h / 1440,
});
const convert = (line: ReturnType<typeof box>, side = 10, ratio = 6) =>
  recomputeAnnotationForTile(line, TILE_0, 0, undefined, 0, undefined, { sliverMinSide: side, sliverAspectRatio: ratio });
afterEach(() => vi.unstubAllGlobals());

describe("clipped sliver filter", () => {
  it("removes a clipped 8 x 180 vertical fragment", () => {
    expect(convert(box(40, 180, 1432))).toBeNull();
  });
  it("removes a clipped 200 x 7 horizontal fragment", () => {
    expect(convert(box(200, 40, 200, 1433))).toBeNull();
  });
  it("keeps a 30 x 30 square and an unclipped 8 x 180 box", () => {
    expect(DEFAULT_SMALL_BOX_THRESHOLD).toBe(0);
    expect(convert(box(30, 30))).not.toBeNull();
    expect(convert(box(8, 180))).not.toBeNull();
  });
  it.each([[12, 180], [8, 20], [10, 180], [8, 48]])("keeps clipped %s x %s when either strict condition is not met", (w, h) => {
    expect(convert(box(w * 2, h, 1440 - w))).not.toBeNull();
  });
  it("removes immediately across strict side/aspect boundaries", () => {
    expect(convert(box(20, 180, 1430.001))).toBeNull();
    expect(convert(box(16, 48.001, 1432))).toBeNull();
  });
  it("ignores coordinate roundoff at the tile edge", () => {
    expect(convert(box(8, 180, 1432 + 1e-12))).not.toBeNull();
  });
  it.each([[0, 6], [10, 0], [0, 0]])("disables sliver filtering for side=%s ratio=%s", (side, ratio) => {
    expect(convert(box(40, 180, 1432), side, ratio)).not.toBeNull();
  });
  it("invalid dimensions still fail with every filter disabled", () => {
    expect(convert(box(0, 180), 0, 0)).toBeNull();
    expect(convert(box(180, 0), 0, 0)).toBeNull();
  });
  it.each(["", NaN, Infinity, -1, undefined, "invalid"])("safely disables invalid input %s", value => {
    expect(sanitizeSliverValue(value)).toBe(0);
  });
  it("preserves manually entered decimal values", () => {
    expect(sanitizeSliverValue("6.5")).toBe(6.5);
  });
  it("stores all four settings including zero values", () => {
    expect(computeSplitData([], 0, 0, 10, 10, 6)).toMatchObject({
      smallBoxThreshold: 0, minRetainedPercentage: 10, sliverMinSide: 10, sliverAspectRatio: 6,
    });
  });
  it("does not count a box twice when an earlier filter removes it", () => {
    const area = vi.fn(), retained = vi.fn(), sliver = vi.fn();
    const options = { sliverMinSide: 10, sliverAspectRatio: 6, onRemoved: sliver };
    const line = box(200, 180, 1432);
    expect(recomputeAnnotationForTile(line, TILE_0, 2000, area, 10, retained, options)).toBeNull();
    expect(area).toHaveBeenCalledTimes(1); expect(retained).not.toHaveBeenCalled(); expect(sliver).not.toHaveBeenCalled();
    expect(recomputeAnnotationForTile(line, TILE_0, 0, area, 10, retained, options)).toBeNull();
    expect(retained).toHaveBeenCalledTimes(1); expect(sliver).not.toHaveBeenCalled();
  });
  it("filters train/valid identically, preserves originals, and produces valid YOLO", async () => {
    vi.stubGlobal("createImageBitmap", async () => ({ close() {} }));
    vi.stubGlobal("document", { createElement: () => ({ getContext: () => ({ drawImage() {} }),
      toBlob: (callback: (blob: Blob) => void) => callback(new Blob(["tile"])),
    }) });
    const text = [box(40, 180, 1432), box(30, 30), box(8, 180)].map(l => `${l.cls} ${l.xCenter} ${l.yCenter} ${l.width} ${l.height}`).join("\n");
    const image = { name: "001.jpg", blob: new Blob(["source"]) };
    const label = { name: "001.txt", blob: new Blob([text]) };
    const result = await runTiling([image], [label], [image], [label], undefined, 0, 10, 10, 6);
    expect(result.sliverBoxesRemoved).toEqual({ train: 1, valid: 1 });
    expect(result.smallBoxesRemoved).toEqual({ train: 0, valid: 0 });
    expect(result.clippedFragmentsRemoved).toEqual({ train: 0, valid: 0 });
    for (let i = 0; i < 2; i++) {
      const output = await result.trainLabels[i].blob.text();
      expect(output).toBe(await result.validLabels[i].blob.text());
      const lines = parseYoloText(output);
      expect(lines).toHaveLength(i === 0 ? 2 : 1);
      for (const line of lines) {
        expect(line.width).toBeGreaterThan(0); expect(line.height).toBeGreaterThan(0);
        expect(line.xCenter - line.width / 2).toBeGreaterThanOrEqual(-0.000001);
        expect(line.xCenter + line.width / 2).toBeLessThanOrEqual(1.000001);
        expect(line.yCenter - line.height / 2).toBeGreaterThanOrEqual(-0.000001);
        expect(line.yCenter + line.height / 2).toBeLessThanOrEqual(1.000001);
      }
    }
    expect(await label.blob.text()).toBe(text);
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { IMAGE_WIDTH, IMAGE_HEIGHT, TILE_0, TILE_1, recomputeAnnotationForTile, recomputeAnnotationTextForTile, parseYoloText } from "../src/lib/tiling";
import { sanitizeSmallBoxThreshold } from "../src/lib/tiling-settings";
import { runTiling } from "../src/lib/tiling-pipeline";
import { computeSplitData } from "../src/components/SplitPicker";

const box = (width: number, height: number, left = 200, top = 200) => ({
  cls: 3, xCenter: (left + width / 2) / IMAGE_WIDTH,
  yCenter: (top + height / 2) / IMAGE_HEIGHT,
  width: width / IMAGE_WIDTH, height: height / IMAGE_HEIGHT,
});

afterEach(() => vi.unstubAllGlobals());

describe("clipped pixel-area threshold", () => {
  it.each([[20, 20, false], [50, 50, true], [10, 200, true], [200, 10, true],
    [10, 99.9, false], [10, 100, true], [10, 100.1, true]])(
    "%s by %s pixels: kept=%s at threshold 1000", (width, height, kept) => {
      expect(recomputeAnnotationForTile(box(width, height), TILE_0, 1000) !== null).toBe(kept);
    },
  );

  it("filters only after clipping, independently per tile", () => {
    const line = box(200, 300, 1438);
    expect(recomputeAnnotationForTile(line, TILE_0, 1000)).toBeNull();
    const survivor = recomputeAnnotationForTile(line, TILE_1, 1000)!;
    expect(survivor.width).toBeCloseTo(200 / 1440);
    expect(survivor.height).toBeCloseTo(300 / 1440);
    expect(survivor.cls).toBe(3);
  });

  it("uses clipped vertical bounds as well", () => {
    expect(recomputeAnnotationForTile(box(20, 100, 200, -80), TILE_0, 1000)).toBeNull();
  });

  it("zero disables filtering and outside boxes do not count as removals", () => {
    const removed = vi.fn();
    expect(recomputeAnnotationForTile(box(1, 1), TILE_0, 0, removed)).not.toBeNull();
    expect(recomputeAnnotationForTile(box(20, 20, 1800), TILE_0, 1000, removed)).toBeNull();
    expect(removed).not.toHaveBeenCalled();
  });

  it.each([NaN, Infinity, -1, "", "invalid", undefined])("sanitizes invalid input %s to zero", value => {
    expect(sanitizeSmallBoxThreshold(value)).toBe(0);
  });
  it("accepts manual values and rounds down to whole pixel areas", () => {
    expect(sanitizeSmallBoxThreshold("750")).toBe(750);
    expect(sanitizeSmallBoxThreshold("500.9")).toBe(500);
    expect(computeSplitData([], 0, 750).smallBoxThreshold).toBe(750);
  });

  it("leaves source text intact and produces an empty annotation if all boxes are small", () => {
    const line = box(20, 20);
    const text = `${line.cls} ${line.xCenter} ${line.yCenter} ${line.width} ${line.height}`;
    expect(recomputeAnnotationTextForTile(text, TILE_0, 1000)).toBe("");
    expect(parseYoloText(text)).toEqual([line]);
  });

  it("applies the same threshold to train/valid and counts only filtered tile boxes", async () => {
    vi.stubGlobal("createImageBitmap", async () => ({ close() {} }));
    vi.stubGlobal("document", { createElement: () => ({
      getContext: () => ({ drawImage() {} }),
      toBlob: (callback: (blob: Blob) => void) => callback(new Blob(["tile"])),
    }) });
    const lines = [box(20, 20), box(10, 200)];
    const text = lines.map(l => `${l.cls} ${l.xCenter} ${l.yCenter} ${l.width} ${l.height}`).join("\n");
    const image = { name: "001.jpg", blob: new Blob(["source"]) };
    const label = { name: "001.txt", blob: new Blob([text]) };
    const result = await runTiling([image], [label], [image], [label], undefined, 1000);
    expect(result.smallBoxThreshold).toBe(1000);
    expect(result.smallBoxesRemoved).toEqual({ train: 1, valid: 1 });
    expect(parseYoloText(await result.trainLabels[0].blob.text())).toHaveLength(1);
    expect(await result.trainLabels[0].blob.text()).toBe(await result.validLabels[0].blob.text());
    expect(await result.trainLabels[1].blob.text()).toBe("");
    expect(await label.blob.text()).toBe(text);
    const disabled = await runTiling([image], [label], [], [], undefined, 0);
    expect(disabled.smallBoxesRemoved).toEqual({ train: 0, valid: 0 });
    expect(parseYoloText(await disabled.trainLabels[0].blob.text())).toHaveLength(2);
  });
});

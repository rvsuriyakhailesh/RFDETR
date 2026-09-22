import { afterEach, describe, expect, it, vi } from "vitest";
import { recomputeAnnotationForTile, parseYoloText, TILE_0, TILE_1 } from "../src/lib/tiling";
import { runTiling } from "../src/lib/tiling-pipeline";
import { sanitizeMinRetainedPercentage } from "../src/lib/tiling-settings";
import { computeSplitData } from "../src/components/SplitPicker";

const box = (width: number, height: number, left = 200, top = 200) => ({
  cls: 2, xCenter: (left + width / 2) / 2560, yCenter: (top + height / 2) / 1440,
  width: width / 2560, height: height / 1440,
});
const convert = (line: ReturnType<typeof box>, area = 1000, retained = 10) =>
  recomputeAnnotationForTile(line, TILE_0, area, undefined, retained);
afterEach(() => vi.unstubAllGlobals());

describe("retained percentage after clipping", () => {
  it.each([[0, 300], [300, 0], [-1, 300], [300, -1]])("rejects invalid %s x %s dimensions even with filters disabled", (w, h) => {
    expect(convert(box(w, h), 0, 0)).toBeNull();
  });
  it("retains the existing area rule and equality boundary", () => {
    expect(convert(box(20, 20))).toBeNull();
    expect(convert(box(100, 100))).not.toBeNull();
    expect(convert(box(10, 100))).not.toBeNull();
  });
  it.each([[10, 300], [300, 10]])("keeps fully contained narrow boxes %s x %s", (w, h) => {
    expect(convert(box(w, h), 1000, 100)).not.toBeNull();
  });
  it("removes a 5% boundary fragment even though its area is 3000", () => {
    const original = box(200, 300, 1430);
    expect(convert(original)).toBeNull();
    expect(recomputeAnnotationForTile(original, TILE_1, 1000, undefined, 10)).not.toBeNull();
  });
  it.each([[9.9, false], [10, true], [10.1, true], [90, true]])("retained %s percent kept=%s at 10 percent", (percentage, kept) => {
    expect(convert(box(200, 300, 1440 - 200 * percentage / 100)) !== null).toBe(kept);
  });
  it("also handles vertical clipping", () => {
    expect(convert(box(300, 200, 200, 1430))).toBeNull();
  });
  it("disables each rule independently", () => {
    expect(convert(box(200, 300, 1430), 1000, 0)).not.toBeNull();
    expect(convert(box(20, 20), 0, 10)).not.toBeNull();
    expect(convert(box(200, 300, 1430), 0, 10)).toBeNull();
    expect(convert(box(200, 10, 1439), 0, 0)).not.toBeNull();
  });
  it("counts a box failing both rules only under area", () => {
    const areaRemoved = vi.fn(), fragmentRemoved = vi.fn();
    expect(recomputeAnnotationForTile(box(200, 300, 1439), TILE_0, 1000, areaRemoved, 10, fragmentRemoved)).toBeNull();
    expect(areaRemoved).toHaveBeenCalledTimes(1);
    expect(fragmentRemoved).not.toHaveBeenCalled();
  });
  it.each([["", 0], [NaN, 0], [Infinity, 0], [-1, 0], [101, 100], ["15", 15], [9.9, 9.9]])("sanitizes percentage %s to %s", (input, expected) => {
    expect(sanitizeMinRetainedPercentage(input)).toBe(expected);
  });
  it("stores both settings without losing explicitly disabled values", () => {
    expect(computeSplitData([], 0, 750, 15)).toMatchObject({ smallBoxThreshold: 750, minRetainedPercentage: 15 });
    expect(computeSplitData([], 0, 0, 0)).toMatchObject({ smallBoxThreshold: 0, minRetainedPercentage: 0 });
  });
  it("uses identical settings and disjoint counts for train and valid, preserving source labels", async () => {
    vi.stubGlobal("createImageBitmap", async () => ({ close() {} }));
    vi.stubGlobal("document", { createElement: () => ({ getContext: () => ({ drawImage() {} }),
      toBlob: (callback: (blob: Blob) => void) => callback(new Blob(["tile"])),
    }) });
    const text = [box(20, 20), box(200, 300, 1430), box(10, 300)].map(l => `${l.cls} ${l.xCenter} ${l.yCenter} ${l.width} ${l.height}`).join("\n");
    const image = { name: "001.jpg", blob: new Blob(["source image"]) };
    const label = { name: "001.txt", blob: new Blob([text]) };
    const result = await runTiling([image], [label], [image], [label], undefined, 1000, 10);
    expect(result.smallBoxesRemoved).toEqual({ train: 1, valid: 1 });
    expect(result.clippedFragmentsRemoved).toEqual({ train: 1, valid: 1 });
    expect(result.minRetainedPercentage).toBe(10);
    for (let i = 0; i < 2; i++) {
      const annotation = await result.trainLabels[i].blob.text();
      expect(annotation).toBe(await result.validLabels[i].blob.text());
      const lines = parseYoloText(annotation);
      expect(lines).toHaveLength(1);
      for (const line of lines) {
        expect(line.xCenter - line.width / 2).toBeGreaterThanOrEqual(-0.000001);
        expect(line.xCenter + line.width / 2).toBeLessThanOrEqual(1.000001);
        expect(line.height).toBeGreaterThan(0);
      }
    }
    expect(await label.blob.text()).toBe(text);
  });
});

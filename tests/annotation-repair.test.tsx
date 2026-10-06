import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import JSZip from "jszip";
import { clipYoloBoxToImageBounds, parseYoloText, validateYoloText } from "../src/lib/tiling";
import { buildFinalZip } from "../src/lib/finalization";
import { loadProcessedDataset } from "../src/lib/processed-dataset";
import { repairProcessedBoundaryBoxes } from "../src/lib/annotation-repair";
import { ValidationResults } from "../src/components/ValidationResults";

beforeEach(() => vi.stubGlobal("Image", class {
  naturalWidth = 1440; naturalHeight = 1440;
  onload: (() => void) | null = null;
  set src(_value: string) { queueMicrotask(() => this.onload?.()); }
}));
afterEach(() => vi.unstubAllGlobals());

const valid = "1 0.3333333333333333 0.5 0.1234567890123456 0.2";
const overflow = "0 0.980000 0.500000 0.100000 0.200000";
async function load(text: string) {
  const blob = await buildFinalZip({ preserveFilenames: true,
    trainImages: [{ name: "001.png", blob: new Blob(["original pixels"]) }],
    trainLabels: [{ name: "001.txt", blob: new Blob([text]) }],
    validImages: [{ name: "002.png", blob: new Blob(["valid pixels"]) }],
    validLabels: [{ name: "002.txt", blob: new Blob([valid]) }], tiledAt: 1,
  }, "Man\nChair", "repair");
  return loadProcessedDataset(blob);
}

describe("clipYoloBoxToImageBounds", () => {
  it("returns an inside box unchanged", () => {
    const box = { cls: 7, xCenter: 0.5, yCenter: 0.5, width: 0.2, height: 0.2 };
    expect(clipYoloBoxToImageBounds(box)).toBe(box);
  });
  it.each([
    [0.98, 0.5, 0.965, 0.5, 0.07, 0.2],
    [0.02, 0.5, 0.035, 0.5, 0.07, 0.2],
    [0.5, 0.02, 0.5, 0.06, 0.1, 0.12],
    [0.5, 0.98, 0.5, 0.94, 0.1, 0.12],
    [0.02, 0.02, 0.035, 0.06, 0.07, 0.12],
    [0.98, 0.02, 0.965, 0.06, 0.07, 0.12],
    [0.02, 0.98, 0.035, 0.94, 0.07, 0.12],
    [0.98, 0.98, 0.965, 0.94, 0.07, 0.12],
  ])("clips edges at (%s,%s), keeping class and positive dimensions", (x, y, xc, yc, w, h) => {
    const box = clipYoloBoxToImageBounds({ cls: 9, xCenter: x, yCenter: y, width: 0.1, height: 0.2 })!;
    expect(box.cls).toBe(9);
    expect(box.xCenter).toBeCloseTo(xc); expect(box.yCenter).toBeCloseTo(yc);
    expect(box.width).toBeCloseTo(w); expect(box.height).toBeCloseTo(h);
    expect(box.width).toBeGreaterThan(0); expect(box.height).toBeGreaterThan(0);
    expect(box.xCenter - box.width / 2).toBeGreaterThanOrEqual(-Number.EPSILON);
    expect(box.xCenter + box.width / 2).toBeLessThanOrEqual(1 + Number.EPSILON);
    expect(box.yCenter - box.height / 2).toBeGreaterThanOrEqual(-Number.EPSILON);
    expect(box.yCenter + box.height / 2).toBeLessThanOrEqual(1 + Number.EPSILON);
  });
  it.each([[1.2, 0.5], [-0.2, 0.5], [0.5, 1.2], [0.5, -0.2]])("removes invisible boxes at %s,%s", (x, y) => {
    expect(clipYoloBoxToImageBounds({ cls: 0, xCenter: x, yCenter: y, width: 0.1, height: 0.1 })).toBeNull();
  });
  it("handles tiny overflow and rejects invalid input", () => {
    const clipped = clipYoloBoxToImageBounds({ cls: 0, xCenter: 0.95000000001, yCenter: 0.5, width: 0.1, height: 0.2 })!;
    expect(clipped.xCenter + clipped.width / 2).toBeCloseTo(1, 14);
    for (const width of [0, -1, 2, NaN, Infinity]) {
      expect(() => clipYoloBoxToImageBounds({ cls: 0, xCenter: 0.5, yCenter: 0.5, width, height: 0.2 })).toThrow();
    }
  });
});

describe("processed boundary repair", () => {
  it("retains a blocked draft and repairs one of six issues, then all, preserving unrelated bytes", async () => {
    const text = [valid, ...Array(6).fill(overflow), "", valid].join("\r\n");
    const result = await load(text);
    expect(result.session).toBeNull(); expect(result.tiled).toBeNull();
    expect(result.draft).toBeDefined(); expect(result.issues).toHaveLength(6);
    expect(result.issues[0]).toMatchObject({ code: "box-out-of-bounds", split: "train", lineNumber: 2 });
    const one = await repairProcessedBoundaryBoxes(result.draft!, [result.issues[0]]);
    expect(one.issues).toHaveLength(5);
    const lines = (await one.draft!.tiled.trainLabels[0].blob.text()).split("\r\n");
    expect(lines[1]).toBe("0 0.965000 0.500000 0.070000 0.200000");
    expect(lines[2]).toBe(overflow); expect(lines[0]).toBe(valid); expect(lines[8]).toBe(valid);
    expect(await result.draft!.tiled.trainLabels[0].blob.text()).toBe(text);
    const all = await repairProcessedBoundaryBoxes(one.draft!, one.issues);
    expect(all.issues).toEqual([]); expect(all.session?.datasetType).toBe("processed-rfdetr");
    expect(all.tiled!.trainImages).toBe(result.draft!.tiled.trainImages);
    expect(all.tiled!.validLabels[0]).toBe(result.draft!.tiled.validLabels[0]);
  });
  it("uses original line indices for 107–109, even when lines are removed", async () => {
    const result = await load([...Array(106).fill(valid), "0 2 0.5 0.1 0.2", overflow, "0 -2 0.5 0.1 0.2", valid].join("\n"));
    expect(result.issues.map(issue => issue.lineNumber)).toEqual([107, 108, 109]);
    const fixed = await repairProcessedBoundaryBoxes(result.draft!, result.issues);
    expect(fixed.issues).toEqual([]);
    const lines = (await fixed.tiled!.trainLabels[0].blob.text()).split("\n");
    expect(lines).toHaveLength(108);
    expect(lines[106]).toBe("0 0.965000 0.500000 0.070000 0.200000");
    expect(lines[107]).toBe(valid);
  });
  it("leaves invalid classes and malformed/dimension errors blocked after boundary repair", async () => {
    const bad = ["9 0.5 0.5 0.2 0.2", "0 NaN 0.5 0.2 0.2", "0 0.5 Infinity 0.2 0.2", "0 0.5 0.5 -0.1 0.2", "0 0.5 0.2"];
    const result = await load([...Array(5).fill(overflow), ...bad].join("\n"));
    const fixed = await repairProcessedBoundaryBoxes(result.draft!, result.issues.filter(i => i.code === "box-out-of-bounds"));
    expect(fixed.session).toBeNull(); expect(fixed.tiled).toBeNull();
    expect(fixed.issues).toHaveLength(5);
    expect(fixed.issues[0].code).toBe("invalid-class");
    expect((await fixed.draft!.tiled.trainLabels[0].blob.text()).split("\n").slice(5)).toEqual(bad);
    await expect(repairProcessedBoundaryBoxes(fixed.draft!, fixed.issues)).rejects.toThrow("Only identified boundary");
  });
  it("refuses stale line targeting without changing the draft", async () => {
    const result = await load(valid + "\n" + overflow);
    await expect(repairProcessedBoundaryBoxes(result.draft!, [{ ...result.issues[0], lineNumber: 1 }])).rejects.toThrow("not a repairable");
    expect(await result.draft!.tiled.trainLabels[0].blob.text()).toBe(valid + "\n" + overflow);
  });
  it("retains tiny visible areas that six decimals would round to zero", async () => {
    const result = await load("0 1.09999999 0.5 0.2 0.2");
    const fixed = await repairProcessedBoundaryBoxes(result.draft!, result.issues);
    expect(fixed.issues).toEqual([]);
    expect(parseYoloText(await fixed.tiled!.trainLabels[0].blob.text())[0].width).toBeGreaterThan(0);
  });
  it("exports the repaired values and reopens without boundary errors", async () => {
    const result = await load(overflow);
    const fixed = await repairProcessedBoundaryBoxes(result.draft!, result.issues);
    const zipBlob = await buildFinalZip(fixed.tiled!, fixed.session!.objNames!.text, fixed.session!.zipBaseName);
    const zip = await JSZip.loadAsync(zipBlob);
    const label = await zip.file("RFDETR_repair/train/labels/001.txt")!.async("string");
    expect(label).toBe("0 0.965000 0.500000 0.070000 0.200000");
    expect(validateYoloText(label, 2)).toEqual([]);
    expect(await zip.file("RFDETR_repair/train/images/001.png")!.async("string")).toBe("original pixels");
    expect((await loadProcessedDataset(zipBlob)).issues).toEqual([]);
  });
  it("offers structured processed repair actions without adding them to raw UI", async () => {
    const result = await load([...Array(6).fill(overflow), "9 0.5 0.5 0.1 0.1"].join("\n"));
    const props = { issues: result.issues, isDeleting: false,
      onSuccess: vi.fn(), onReset: vi.fn(), onDeleteResolutionErrors: vi.fn() };
    const markup = renderToStaticMarkup(<ValidationResults {...props} onFixBoundaryBoxes={vi.fn()} />);
    expect(markup).toContain("Fix All 6 Boundary Boxes");
    expect(markup.match(/>Fix Box</g)).toHaveLength(6);
    expect(markup).not.toContain(">Continue<");
    const raw = renderToStaticMarkup(<ValidationResults {...props} />);
    expect(raw).not.toContain("Fix Box"); expect(raw).not.toContain("Fix All");
    const busy = renderToStaticMarkup(<ValidationResults {...props} onFixBoundaryBoxes={vi.fn()} isRepairing />);
    expect(busy.match(/disabled=""/g)).toHaveLength(8);
  });
});

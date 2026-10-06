import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import JSZip from "jszip";
import { buildFinalZip } from "../src/lib/finalization";
import { detectDatasetType, loadProcessedDataset } from "../src/lib/processed-dataset";
import { orderedDatasetItems, updateDatasetSplit } from "../src/lib/dataset-items";
import type { TiledData } from "../src/lib/types";

beforeEach(() => {
  vi.stubGlobal("Image", class {
    naturalWidth = 1440;
    naturalHeight = 1440;
    onload: (() => void) | null = null;
    set src(_value: string) { queueMicrotask(() => this.onload?.()); }
  });
});
afterEach(() => vi.unstubAllGlobals());

function dataset(count = 194, trainCount = 150): TiledData {
  const images = Array.from({ length: count }, (_, i) => ({ name: `${i + 1}.jpg`, blob: new Blob([`pixels ${i + 1}`]) }));
  const labels = images.map(image => ({ name: image.name.replace(".jpg", ".txt"), blob: new Blob(["1 0.333333333 0.5 0.2 0.3\n"]) }));
  return { trainImages: images.slice(0, trainCount), trainLabels: labels.slice(0, trainCount),
    validImages: images.slice(trainCount), validLabels: labels.slice(trainCount), tiledAt: 1 };
}
const exportDataset = (tiled: TiledData) => buildFinalZip(tiled, "Man\nChair\n", "seats");
async function rewriteZip(edit: (zip: JSZip) => void) {
  const zip = await JSZip.loadAsync(await exportDataset(dataset(3, 2)));
  edit(zip);
  return zip.generateAsync({ type: "blob" });
}

describe("processed dataset detection", () => {
  it("distinguishes raw and unrelated files from exact generated output", async () => {
    expect(detectDatasetType(["data/001.jpg"])).toBe("raw");
    expect(detectDatasetType(["obj_train_data/001.txt", "obj.names"])).toBe("raw");
    expect(detectDatasetType(["random.txt"])).toBe("invalid");
    expect(detectDatasetType(["train/images/001.jpg", "train/labels/001.txt"])).toBe("invalid");
    const zip = await JSZip.loadAsync(await exportDataset(dataset(3, 2)));
    expect(detectDatasetType(Object.keys(zip.files))).toBe("processed-rfdetr");
  });
  it("reports a missing folder without falling back to raw", async () => {
    const result = await loadProcessedDataset(await rewriteZip(zip => zip.remove("RFDETR_seats/train/labels")));
    expect(result.session).toBeNull();
    expect(result.issues.some(issue => issue.reason.includes("train labels folder is missing"))).toBe(true);
  });
  it("requires the matching root class names and rejects extra roots", async () => {
    for (const edit of [(zip: JSZip) => zip.remove("RFDETR_seats/RFDETR_seats_obj.names"),
      (zip: JSZip) => zip.file("unrelated/file.txt", "extra")]) {
      expect((await loadProcessedDataset(await rewriteZip(edit))).session).toBeNull();
    }
  });
});

describe("processed validation", () => {
  it("reports missing pairs and malformed annotations with line numbers", async () => {
    const broken = await rewriteZip(zip => {
      zip.remove("RFDETR_seats/train/labels/seats_1.txt");
      zip.file("RFDETR_seats/valid/labels/seats_3.txt", "9 0.5 0.5 0.2 0.2");
    });
    const result = await loadProcessedDataset(broken);
    expect(result.session).toBeNull();
    expect(result.issues.some(issue => issue.type === "orphaned-image")).toBe(true);
    expect(result.issues.some(issue => issue.type === "invalid-annotation" && issue.reason.includes("Line 1"))).toBe(true);
  });
  it("rejects conflicting basenames across splits", async () => {
    const blob = await rewriteZip(zip => {
      zip.file("RFDETR_seats/valid/images/seats_1.jpg", "duplicate pixels");
      zip.file("RFDETR_seats/valid/labels/seats_1.txt", "");
    });
    expect((await loadProcessedDataset(blob)).issues.some(issue => issue.type === "duplicate-filename")).toBe(true);
  });
  it("rejects unreadable images and corrupt archives", async () => {
    vi.stubGlobal("Image", class {
      onerror: (() => void) | null = null;
      set src(_value: string) { queueMicrotask(() => this.onerror?.()); }
    });
    expect((await loadProcessedDataset(await exportDataset(dataset(2, 1)))).session).toBeNull();
    expect((await loadProcessedDataset(new Blob(["not a ZIP"]))).issues.length).toBeGreaterThan(0);
  });
  it("allows empty Valid and rejects empty Train", async () => {
    expect((await loadProcessedDataset(await exportDataset(dataset(2, 2)))).tiled?.validImages).toHaveLength(0);
    expect((await loadProcessedDataset(await exportDataset(dataset(2, 0)))).issues.some(issue => issue.reason.includes("At least one Train"))).toBe(true);
  });
  it("detects duplicate central-directory paths before JSZip can overwrite them", async () => {
    const zip = new JSZip();
    zip.file("same1.txt", "one"); zip.file("same2.txt", "two");
    const bytes = await zip.generateAsync({ type: "uint8array", compression: "STORE" });
    const original = new TextEncoder().encode("same2.txt");
    const replacement = new TextEncoder().encode("same1.txt");
    for (let i = 0; i <= bytes.length - original.length; i++) {
      if (original.every((value, j) => bytes[i + j] === value)) bytes.set(replacement, i);
    }
    expect((await loadProcessedDataset(new Blob([bytes]))).issues[0].reason).toContain("Duplicate ZIP path");
  });
});

describe("round-trip and editor split integrity", () => {
  it("moves 150/44 to 160/34 and backward to 120/74 without recreating images or annotations", async () => {
    const loaded = await loadProcessedDataset(await exportDataset(dataset()));
    expect(loaded.issues).toEqual([]);
    expect(loaded.session?.datasetType).toBe("processed-rfdetr");
    const tiled = loaded.tiled!;
    const ordered = orderedDatasetItems(tiled);
    expect(ordered.slice(0, 3).map(item => item.image.name)).toEqual(["seats_1.jpg", "seats_2.jpg", "seats_3.jpg"]);
    expect(tiled.trainImages).toHaveLength(150);
    const forward = updateDatasetSplit(tiled, 159);
    expect(forward.trainImages).toHaveLength(160); expect(forward.validImages).toHaveLength(34);
    const backward = updateDatasetSplit(forward, 119);
    expect(backward.trainImages).toHaveLength(120); expect(backward.validImages).toHaveLength(74);
    orderedDatasetItems(backward).forEach((item, i) => {
      expect(item.image).toBe(ordered[i].image); expect(item.label).toBe(ordered[i].label);
      expect(item.split).toBe(i <= 119 ? "train" : "valid");
    });
    let current = backward;
    for (let cycle = 0; cycle < 3; cycle++) {
      const blob = await exportDataset(current);
      const zip = await JSZip.loadAsync(blob);
      for (const [split, count] of [["train", 120], ["valid", 74]] as const) {
        for (const folder of ["images", "labels"]) {
          expect(Object.values(zip.files).filter(file => !file.dir && file.name.startsWith(`RFDETR_seats/${split}/${folder}/`))).toHaveLength(count);
        }
      }
      const result = await loadProcessedDataset(blob);
      expect(result.issues).toEqual([]);
      current = result.tiled!;
      const items = orderedDatasetItems(current);
      for (let i = 0; i < items.length; i++) {
        expect(items[i].image.name).toBe(ordered[i].image.name);
        expect(await items[i].image.blob.text()).toBe(await ordered[i].image.blob.text());
        expect(await items[i].label.blob.text()).toBe(await ordered[i].label.blob.text());
      }
    }
  });
  it("includes selected image, allows all Train, and rejects invalid indices", () => {
    const tiled = { ...dataset(10, 5), preserveFilenames: true };
    expect(updateDatasetSplit(tiled, 0).trainImages).toHaveLength(1);
    expect(updateDatasetSplit(tiled, 9).validImages).toHaveLength(0);
    expect(() => updateDatasetSplit(tiled, -1)).toThrow();
    expect(() => updateDatasetSplit(tiled, 10)).toThrow();
  });
});

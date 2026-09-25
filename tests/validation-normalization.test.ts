import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import JSZip from "jszip";
import { validateZipFiles } from "../src/lib/validation";
import { computeSplitData } from "../src/components/SplitPicker";
import { runTiling } from "../src/lib/tiling-pipeline";
import { buildFinalZip } from "../src/lib/finalization";
import { formatYoloLine, parseYoloText } from "../src/lib/tiling";
import { moveSelectedBoxes } from "../src/lib/editor";

// Only browser image decoding and rasterization are substituted. ZIP loading,
// validation, splitting, annotation tiling/editing, and ZIP generation are real.
beforeEach(() => {
  vi.stubGlobal("Image", class {
    naturalWidth = 2560;
    naturalHeight = 1440;
    onload: (() => void) | null = null;
    set src(_value: string) { queueMicrotask(() => this.onload?.()); }
  });
  vi.stubGlobal("createImageBitmap", async () => ({ close() {} }));
  vi.stubGlobal("document", {
    createElement: () => ({
      getContext: () => ({ drawImage() {} }),
      toBlob: (callback: (blob: Blob) => void) => callback(new Blob(["tile bytes"], { type: "image/jpeg" })),
    }),
  });
});

afterEach(() => vi.unstubAllGlobals());

async function uploadedZips(images: string[], annotations: string[]) {
  const backup = new JSZip();
  const labels = new JSZip();
  images.forEach(name => backup.file(`data/${name}`, `image bytes:${name}`));
  annotations.forEach((name, index) => labels.file(`obj_train_data/${name}`, `${index} 0.3 0.5 0.1 0.2`));
  labels.file("obj.names", "seat0\nseat1\nseat2\nseat3\n");
  // JSZip accepts byte buffers in Node; attach upload names for the File API.
  const file1 = Object.assign(await backup.generateAsync({ type: "uint8array" }), { name: "seats_backup.zip" }) as unknown as File;
  const file2 = Object.assign(await labels.generateAsync({ type: "uint8array" }), { name: "seats.zip" }) as unknown as File;
  return [file1, file2] as const;
}

describe("normalization at the ZIP upload boundary", () => {
  it("preserves bytes and pairing, numeric sort, split, tiling, editor edits, and final ZIP paths", async () => {
    const files = await uploadedZips(["100.jpg", "02.png", "01.jpeg", "10.jpg"], ["10.txt", "01.txt", "100.txt", "02.txt"]);
    const result = await validateZipFiles(...files);
    expect(result.issues).toEqual([]);
    expect(result.session).not.toBeNull();
    const session = result.session!;
    for (const pair of session.pairs) {
      expect(pair.image.name.replace(/\.[^.]+$/, "")).toBe(pair.annotation.name.replace(/\.txt$/, ""));
    }
    const first = session.pairs.find(pair => pair.image.name === "001.jpeg")!;
    expect(await first.image.blob.text()).toBe("image bytes:01.jpeg");
    expect(first.annotation.text).toBe("1 0.3 0.5 0.1 0.2");

    const split = computeSplitData(session.pairs, 1);
    expect(split.trainImages.map(f => f.name)).toEqual(["001.jpeg", "002.png"]);
    expect(split.trainLabels.map(f => f.name)).toEqual(["001.txt", "002.txt"]);
    expect(split.validImages.map(f => f.name)).toEqual(["010.jpg", "100.jpg"]);
    const tiled = await runTiling(split.trainImages, split.trainLabels, split.validImages, split.validLabels);
    expect(tiled.trainImages.map(f => f.name)).toEqual(["001_1.jpg", "001_2.jpg", "002_1.jpg", "002_2.jpg"]);
    expect(tiled.trainLabels.map(f => f.name)).toEqual(["001_1.txt", "001_2.txt", "002_1.txt", "002_2.txt"]);
    // Exercise the editor's movement/serialization on normalized tile labels.
    const label = tiled.trainLabels[0];
    const edited = moveSelectedBoxes(parseYoloText(await label.blob.text()), new Set([0]), 0.01, 0);
    label.blob = new Blob([edited.map(formatYoloLine).join("\n")]);
    const zip = await JSZip.loadAsync(await buildFinalZip(tiled, session.objNames!.text, session.zipBaseName));
    const paths = Object.keys(zip.files).filter(name => !zip.files[name].dir);
    expect(paths).toHaveLength(17);
    expect(paths.every(name => name.startsWith("RFDETR_seats/"))).toBe(true);
    expect(zip.file("RFDETR_seats/train/images/seats_001_1.jpg")).not.toBeNull();
    expect(zip.file("RFDETR_seats/valid/images/seats_100_2.jpg")).not.toBeNull();
    expect(await zip.file("RFDETR_seats/train/labels/seats_001_1.txt")!.async("string")).toBe(await label.blob.text());
    expect(await zip.file("RFDETR_seats/RFDETR_seats_obj.names")!.async("string")).toBe("seat0\nseat1\nseat2\nseat3\n");
  });

  it("keeps mixed datasets untouched", async () => {
    const result = await validateZipFiles(...await uploadedZips(["01.jpg", "camera02.jpg"], ["camera02.txt", "01.txt"]));
    expect(result.issues).toEqual([]);
    expect(result.session!.pairs.map(p => p.image.name).sort()).toEqual(["01.jpg", "camera02.jpg"]);
  });

  it("still reports unmatched original image/annotation stems", async () => {
    const result = await validateZipFiles(...await uploadedZips(["01.jpg"], ["1.txt"]));
    expect(result.session).toBeNull();
    expect(result.issues.map(issue => issue.type)).toEqual(["orphaned-image", "orphaned-annotation"]);
  });

  it("rejects collisions with a clear validation issue instead of overwriting", async () => {
    const result = await validateZipFiles(...await uploadedZips(["01.jpg", "001.jpg"], ["01.txt", "001.txt"]));
    expect(result.session).toBeNull();
    expect(result.issues).toHaveLength(2);
    expect(result.issues.every(issue => issue.type === "duplicate-filename" && issue.reason.includes("same stem '001'"))).toBe(true);
  });
});

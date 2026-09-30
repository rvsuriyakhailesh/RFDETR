import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import JSZip from "jszip";
import { deleteResolutionErrors, validateZipFiles } from "../src/lib/validation";
import { computeSplitData } from "../src/components/SplitPicker";
import { runTiling } from "../src/lib/tiling-pipeline";
import { buildFinalZip } from "../src/lib/finalization";

// Only browser image decoding and rasterization are substituted. ZIP loading,
// validation, splitting, annotation tiling/editing, and ZIP generation are real.
beforeEach(() => {
  const blobs = new Map<string, Blob>();
  vi.spyOn(URL, "createObjectURL").mockImplementation(blob => {
    const url = `blob:${blobs.size}`;
    blobs.set(url, blob as Blob);
    return url;
  });
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  vi.stubGlobal("Image", class {
    naturalWidth = 2560;
    naturalHeight = 1440;
    onload: (() => void) | null = null;
    set src(value: string) {
      void blobs.get(value)!.text().then(text => {
        if (text.startsWith("invalid:")) { this.naturalWidth = 1024; this.naturalHeight = 572; }
        this.onload?.();
      });
    }
  });
  vi.stubGlobal("createImageBitmap", async () => ({ close() {} }));
  vi.stubGlobal("document", {
    createElement: () => ({
      getContext: () => ({ drawImage() {} }),
      toBlob: (callback: (blob: Blob) => void) => callback(new Blob(["tile bytes"], { type: "image/jpeg" })),
    }),
  });
});

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

async function uploadedZips(images: string[], annotations: string[], invalid = images, badYolo: string[] = []) {
  const backup = new JSZip();
  const labels = new JSZip();
  images.forEach(name => backup.file(`data/${name}`, `${invalid.includes(name) ? "invalid" : "valid"}:${name}`));
  annotations.forEach(name => labels.file(`obj_train_data/${name}`, badYolo.includes(name) ? "broken yolo" : "0 0.3 0.5 0.1 0.2"));
  labels.file("obj.names", "seat0\nseat1\nseat2\nseat3\n");
  // JSZip accepts byte buffers in Node; attach upload names for the File API.
  const file1 = Object.assign(await backup.generateAsync({ type: "uint8array" }), { name: "seats_backup.zip" }) as unknown as File;
  const file2 = Object.assign(await labels.generateAsync({ type: "uint8array" }), { name: "seats.zip" }) as unknown as File;
  return [file1, file2] as const;
}

const invalidNames = [
  "image (5).jpg", "under_score.jpeg", "Gemini_Generated_Image_6j52866j52866j52.png",
  "a.bmp", "b.tif", "c.tiff", "long name with spaces.jpg", "nested/image.png", "UPPER.JPG",
];
const annotation = (name: string) => name.replace(/\.[^.]+$/, ".txt");
const good = ["valid train.jpg", "valid validation.png"];
const resolutionCount = (result: Awaited<ReturnType<typeof validateZipFiles>>) => result.issues.filter(i => i.type === "resolution").length;

describe("resolution cleanup", () => {
  it("deletes an exact image/annotation pair and leaves similarly named files untouched", async () => {
    const names = ["image (5).jpg", "image (50).png", "prefix_image (5).jpeg"];
    const original = await validateZipFiles(...await uploadedZips(names, names.map(annotation), [names[0]]));
    const cleaned = await deleteResolutionErrors(original, [names[0]]);
    expect(cleaned.issues).toEqual([]);
    expect(cleaned.dataset!.images.map(f => f.name)).toEqual(names.slice(1));
    expect(cleaned.dataset!.annotations.map(f => f.name)).toEqual(names.slice(1).map(annotation));
    expect(cleaned.session!.totalImages).toBe(2);
    expect(cleaned.session!.totalAnnotations).toBe(2);
    expect(original.dataset!.images).toHaveLength(3); // No partial mutation.
  });

  it("detects and removes an invalid image even when its annotation is missing", async () => {
    const result = await validateZipFiles(...await uploadedZips([...good, "missing.jpg"], good.map(annotation), ["missing.jpg"]));
    expect(result.issues.map(i => i.type)).toEqual(["orphaned-image", "resolution"]);
    const cleaned = await deleteResolutionErrors(result, ["missing.jpg"]);
    expect(cleaned.issues).toEqual([]);
    expect(cleaned.session!.pairs).toHaveLength(2);
  });

  it("updates 9 ? 8 ? 0 and excludes removed files from split, tiles, labels, and final ZIP", async () => {
    const names = [...good, ...invalidNames];
    const result = await validateZipFiles(...await uploadedZips(names, names.map(annotation), invalidNames));
    expect(resolutionCount(result)).toBe(9);
    const oneRemoved = await deleteResolutionErrors(result, [invalidNames[0]]);
    expect(resolutionCount(oneRemoved)).toBe(8);
    expect(oneRemoved.dataset!.images).toHaveLength(10);
    expect(oneRemoved.dataset!.annotations).toHaveLength(10);
    const cleaned = await deleteResolutionErrors(oneRemoved, invalidNames.slice(1));
    expect(resolutionCount(cleaned)).toBe(0);
    expect(cleaned.issues).toEqual([]);
    expect(cleaned.dataset!.images).toHaveLength(2);
    expect(cleaned.dataset!.annotations).toHaveLength(2);
    const session = cleaned.session!;
    expect(session.totalImages).toBe(2);
    expect(session.totalAnnotations).toBe(2);
    const split = computeSplitData(session.pairs, 0);
    expect([...split.trainImages, ...split.validImages].map(f => f.name).sort()).toEqual(good);
    expect([...split.trainLabels, ...split.validLabels].map(f => f.name).sort()).toEqual(good.map(annotation));
    const tiled = await runTiling(split.trainImages, split.trainLabels, split.validImages, split.validLabels);
    const allTiles = [...tiled.trainImages, ...tiled.validImages, ...tiled.trainLabels, ...tiled.validLabels];
    expect(allTiles).toHaveLength(8);
    expect(allTiles.every(f => f.name.startsWith("valid train_") || f.name.startsWith("valid validation_"))).toBe(true);
    const zip = await JSZip.loadAsync(await buildFinalZip(tiled, session.objNames!.text, session.zipBaseName));
    const paths = Object.keys(zip.files).filter(p => !zip.files[p].dir);
    expect(paths).toHaveLength(9);
    expect(paths.every(p => p.endsWith("obj.names") || p.includes("seats_valid train_") || p.includes("seats_valid validation_"))).toBe(true);
  });

  it("deletes all nine in one action while preserving unrelated validation issues", async () => {
    const names = [...invalidNames, ...good, "orphan1.jpg", "orphan2.png"];
    const result = await validateZipFiles(...await uploadedZips(names, [...invalidNames, ...good].map(annotation), invalidNames, [annotation(good[0])]));
    const unrelated = result.issues.filter(i => i.type !== "resolution");
    expect(unrelated.filter(i => i.type === "orphaned-image")).toHaveLength(2);
    expect(unrelated.some(i => i.type === "invalid-annotation")).toBe(true);
    const cleaned = await deleteResolutionErrors(result, invalidNames);
    expect(cleaned.issues).toEqual(unrelated);
    expect(cleaned.session).toBeNull();
    expect(cleaned.dataset!.images).toHaveLength(4);
    expect(cleaned.dataset!.annotations).toHaveLength(2);
  });

  it("never renormalizes remaining numeric filenames", async () => {
    const result = await validateZipFiles(...await uploadedZips(["1.jpg", "2.png", "100.jpeg"], ["1.txt", "2.txt", "100.txt"], ["100.jpeg"]));
    const cleaned = await deleteResolutionErrors(result, ["100.jpeg"]);
    expect(cleaned.session!.pairs.map(p => p.image.name)).toEqual(["001.jpg", "002.png"]);
  });

  it("blocks continuing when deletion leaves an empty dataset", async () => {
    const result = await validateZipFiles(...await uploadedZips(["bad.jpg"], ["bad.txt"]));
    const cleaned = await deleteResolutionErrors(result, ["bad.jpg"]);
    expect(resolutionCount(cleaned)).toBe(0);
    expect(cleaned.session).toBeNull();
    expect(cleaned.issues.every(i => i.type === "zip-structure")).toBe(true);
    expect(cleaned.dataset!.images).toEqual([]);
    expect(cleaned.dataset!.annotations).toEqual([]);
  });

  it("rejects stale requests and requests containing valid files without partial deletion", async () => {
    const result = await validateZipFiles(...await uploadedZips([...good, "bad.jpg"], [...good.map(annotation), "bad.txt"], ["bad.jpg"]));
    await expect(deleteResolutionErrors(result, ["bad.jpg", good[0]])).rejects.toThrow("No files were deleted");
    expect(result.dataset!.images).toHaveLength(3);
    const cleaned = await deleteResolutionErrors(result, ["bad.jpg"]);
    await expect(deleteResolutionErrors(cleaned, ["bad.jpg"])).rejects.toThrow("No files were deleted");
  });

  it("refuses to orphan a valid image sharing the exact basename", async () => {
    const result = await validateZipFiles(...await uploadedZips(["same.jpg", "same.png"], ["same.txt"], ["same.jpg"]));
    await expect(deleteResolutionErrors(result, ["same.jpg"])).rejects.toThrow("shared with a remaining image");
    expect(result.dataset!.images).toHaveLength(2);
    expect(result.dataset!.annotations).toHaveLength(1);
  });
});

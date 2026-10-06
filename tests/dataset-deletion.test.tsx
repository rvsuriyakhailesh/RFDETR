import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import JSZip from "jszip";
import { TileViewer } from "../src/components/TileViewer";
import { deleteDatasetItem, orderedDatasetItems, updateDatasetSplit } from "../src/lib/dataset-items";
import { buildFinalZip } from "../src/lib/finalization";
import type { TiledData } from "../src/lib/types";

function dataset(count = 6, trainCount = 3): TiledData {
  const images = Array.from({ length: count }, (_, i) => ({ name: `${i + 1}.jpg`, blob: new Blob([`pixels ${i + 1}`]) }));
  const labels = images.map(image => ({ name: image.name.replace(".jpg", ".txt"), blob: new Blob(["0 0.5 0.5 0.2 0.2"]) }));
  return { preserveFilenames: true, trainImages: images.slice(0, trainCount), trainLabels: labels.slice(0, trainCount),
    validImages: images.slice(trainCount), validLabels: labels.slice(trainCount), tiledAt: 1 };
}

describe("whole image and annotation deletion", () => {
  it.each(["jpg", "jpeg", "png"])("matches an exact %s basename and preserves unrelated file references", extension => {
    const tiled = dataset();
    tiled.trainImages[1] = { ...tiled.trainImages[1], name: `2.${extension}` };
    tiled.trainImages.push({ name: "20.jpg", blob: new Blob(["unrelated"]) });
    tiled.trainLabels.push({ name: "20.txt", blob: new Blob([""]) });
    const result = deleteDatasetItem(tiled, "train", `2.${extension}`);
    expect(result.warning).toBeUndefined();
    expect(result.tiled.trainImages.map(image => image.name)).toEqual(["1.jpg", "3.jpg", "20.jpg"]);
    expect(result.tiled.trainLabels.map(label => label.name)).toEqual(["1.txt", "3.txt", "20.txt"]);
    expect(result.tiled.validImages).toBe(tiled.validImages);
    expect(result.tiled.validLabels).toBe(tiled.validLabels);
    expect(result.tiled.trainImages[0]).toBe(tiled.trainImages[0]);
    expect(result.tiled.trainLabels[0]).toBe(tiled.trainLabels[0]);
    expect(tiled.trainImages).toHaveLength(4);
  });

  it("removes Valid pairs without changing Train membership or boundary", () => {
    const tiled = dataset();
    const result = deleteDatasetItem(tiled, "valid", "5.jpg").tiled;
    expect(result.trainImages).toBe(tiled.trainImages);
    expect(result.trainLabels).toBe(tiled.trainLabels);
    expect(result.validImages.map(image => image.name)).toEqual(["4.jpg", "6.jpg"]);
    expect(result.validLabels.map(label => label.name)).toEqual(["4.txt", "6.txt"]);
    expect(orderedDatasetItems(result).filter(item => item.split === "train").pop()?.image.name).toBe("3.jpg");
  });

  it("updates the last Train indicator only when the boundary item is removed", () => {
    const tiled = dataset();
    const beforeBoundary = deleteDatasetItem(tiled, "train", "1.jpg").tiled;
    expect(beforeBoundary.trainImages.map(image => image.name)).toEqual(["2.jpg", "3.jpg"]);
    const boundary = deleteDatasetItem(tiled, "train", "3.jpg").tiled;
    expect(boundary.trainImages.map(image => image.name)).toEqual(["1.jpg", "2.jpg"]);
    expect(boundary.validImages).toBe(tiled.validImages);
  });

  it("uses remaining canonical items for subsequent split changes", () => {
    const tiled = deleteDatasetItem(dataset(), "train", "2.jpg").tiled;
    const changed = updateDatasetSplit(tiled, 2);
    expect(changed.trainImages.map(image => image.name)).toEqual(["1.jpg", "3.jpg", "4.jpg"]);
    expect(changed.validImages.map(image => image.name)).toEqual(["5.jpg", "6.jpg"]);
    const removed = deleteDatasetItem(changed, "train", "3.jpg").tiled;
    expect(removed.trainImages.map(image => image.name)).toEqual(["1.jpg", "4.jpg"]);
    expect(removed.validImages.map(image => image.name)).toEqual(["5.jpg", "6.jpg"]);
  });

  it("keeps an image with a missing label navigable and deletes it with a warning", () => {
    const tiled = dataset();
    tiled.trainLabels = tiled.trainLabels.filter(label => label.name !== "2.txt");
    const items = orderedDatasetItems(tiled);
    expect(items).toHaveLength(6);
    expect(items[1].missingAnnotation).toBe(true);
    expect(() => updateDatasetSplit(tiled, 2)).toThrow(/missing its annotation/);
    const result = deleteDatasetItem(tiled, "train", "2.jpg");
    expect(result.warning).toContain("2.txt was already missing");
    expect(result.tiled.trainImages).toHaveLength(2);
    expect(result.tiled.trainLabels).toHaveLength(2);
  });

  it("protects the final dataset image and the final Train image", () => {
    expect(() => deleteDatasetItem(dataset(1, 1), "train", "1.jpg")).toThrow("At least one image must remain");
    expect(() => deleteDatasetItem(dataset(3, 1), "train", "1.jpg")).toThrow("At least one Train image must remain");
    expect(() => deleteDatasetItem(dataset(), "train", "missing.jpg")).toThrow("Image was not found");
  });

  it("exports exactly 185 pairs after nine deletions from a 194-image dataset", async () => {
    let tiled = dataset(194, 150);
    const deleted = [1, 50, 100, 120, 150, 151, 160, 180, 194];
    for (const number of deleted) tiled = deleteDatasetItem(tiled, number <= 150 ? "train" : "valid", `${number}.jpg`).tiled;
    expect(tiled.trainImages).toHaveLength(145); expect(tiled.validImages).toHaveLength(40);
    const zip = await JSZip.loadAsync(await buildFinalZip(tiled, "person", "edited"));
    expect(Object.values(zip.files).filter(file => !file.dir)).toHaveLength(185 * 2 + 1);
    for (const number of deleted) for (const split of ["train", "valid"]) {
      expect(zip.file(`RFDETR_edited/${split}/images/${number}.jpg`)).toBeNull();
      expect(zip.file(`RFDETR_edited/${split}/labels/${number}.txt`)).toBeNull();
    }
    for (const item of orderedDatasetItems(tiled)) {
      expect(await zip.file(`RFDETR_edited/${item.split}/images/${item.image.name}`)!.async("string")).toBe(await item.image.blob.text());
      expect(await zip.file(`RFDETR_edited/${item.split}/labels/${item.label.name}`)!.async("string")).toBe(await item.label.blob.text());
    }
  });
});

function render(datasetType: "raw" | "processed-rfdetr", tiled = dataset()) {
  return renderToStaticMarkup(<TileViewer tiled={tiled} datasetType={datasetType} objNamesText="person"
    onBack={vi.fn()} onSave={vi.fn()} onFinalize={vi.fn()} onUpdateSplit={vi.fn()} onDeleteImage={vi.fn()} />);
}

describe("processed-only editor controls", () => {
  it("shows both management actions in processed mode", () => {
    const markup = render("processed-rfdetr");
    expect(markup).toContain("Delete Image");
    expect(markup).toContain("Mark as Last Train Image");
    expect(markup).toContain("Train: 3 | Valid: 3 | Last Train Image: 3.jpg");
  });
  it("hides both management actions in raw mode even with final-looking file metadata", () => {
    const markup = render("raw");
    expect(markup).not.toContain("Delete Image");
    expect(markup).not.toContain("Mark as Last Train Image");
    expect(markup).toContain("Delete selected (Del or Ctrl+D)");
    expect(markup).toContain("Draw (D)");
  });
  it("explains the final-image protection and renders an empty dataset safely", () => {
    expect(render("processed-rfdetr", dataset(1, 1))).toContain("At least one image must remain in the dataset.");
    expect(render("processed-rfdetr", dataset(0, 0))).toContain("No tile images found.");
  });
});

import type { TiledData, TiledFile } from "./types";

export interface DatasetItem {
  image: TiledFile;
  label: TiledFile;
  split: "train" | "valid";
  missingAnnotation?: boolean;
}

const EMPTY_ANNOTATION = new Blob([], { type: "text/plain" });

/** One order for editor navigation and editor split changes. Legacy raw order is unchanged. */
export function orderedDatasetItems(tiled: TiledData): DatasetItem[] {
  const items: DatasetItem[] = [];
  for (const split of ["train", "valid"] as const) {
    const images = split === "train" ? tiled.trainImages : tiled.validImages;
    const labels = split === "train" ? tiled.trainLabels : tiled.validLabels;
    const byName = new Map(labels.map(label => [label.name, label]));
    for (const image of images) {
      const label = byName.get(`${image.name.replace(/\.[^.]+$/, "")}.txt`);
      if (!label) {
        // Keep damaged resumed items navigable so the user can remove them.
        if (tiled.preserveFilenames) items.push({ image, split, missingAnnotation: true,
          label: { name: `${image.name.replace(/\.[^.]+$/, "")}.txt`, blob: EMPTY_ANNOTATION } });
        continue;
      }
      items.push({ image, label, split });
    }
  }
  return items.sort((a, b) =>
    (tiled.preserveFilenames
      ? a.image.name.localeCompare(b.image.name, "en", { numeric: true })
      : a.image.name.localeCompare(b.image.name)) || a.image.name.localeCompare(b.image.name, "en") || a.split.localeCompare(b.split));
}

/** Reassign references only: pixels, label blobs and names remain untouched. */
export function updateDatasetSplit(tiled: TiledData, lastTrainIndex: number): TiledData {
  const items = orderedDatasetItems(tiled);
  if (items.some(item => item.missingAnnotation)) {
    throw new Error("An image is missing its annotation. Delete the damaged item before updating the split.");
  }
  if (!Number.isInteger(lastTrainIndex) || lastTrainIndex < 0 || lastTrainIndex >= items.length) {
    throw new Error("Choose an existing image as the last Train image.");
  }
  const train = items.slice(0, lastTrainIndex + 1);
  const valid = items.slice(lastTrainIndex + 1);
  for (const group of [train, valid]) {
    if (new Set(group.map(item => item.label.name)).size !== group.length) {
      throw new Error("This split would create conflicting filenames. Split was not changed.");
    }
  }
  return {
    ...tiled,
    trainImages: train.map(item => item.image), trainLabels: train.map(item => item.label),
    validImages: valid.map(item => item.image), validLabels: valid.map(item => item.label),
  };
}

/** Delete exactly one partition's image/annotation pair without reassigning other items. */
export function deleteDatasetItem(
  tiled: TiledData, split: "train" | "valid", imageName: string,
): { tiled: TiledData; warning?: string } {
  const imageKey = split === "train" ? "trainImages" : "validImages";
  const labelKey = split === "train" ? "trainLabels" : "validLabels";
  if (!tiled[imageKey].some(image => image.name === imageName)) throw new Error("Image was not found. Nothing was deleted.");
  const blocked = imageDeletionBlockReason(tiled, split);
  if (blocked) throw new Error(blocked);
  const annotationName = `${imageName.replace(/\.[^.]+$/, "")}.txt`;
  const annotationExists = tiled[labelKey].some(label => label.name === annotationName);
  return {
    tiled: { ...tiled,
      [imageKey]: tiled[imageKey].filter(image => image.name !== imageName),
      [labelKey]: tiled[labelKey].filter(label => label.name !== annotationName),
    },
    warning: annotationExists ? undefined : `Deleted ${imageName}. Its matching annotation ${annotationName} was already missing.`,
  };
}

export function imageDeletionBlockReason(tiled: TiledData, split: "train" | "valid"): string | undefined {
  if (tiled.trainImages.length + tiled.validImages.length <= 1) return "At least one image must remain in the dataset.";
  if (split === "train" && tiled.trainImages.length <= 1) {
    return "At least one Train image must remain. Mark another image as Train before deleting this one.";
  }
}

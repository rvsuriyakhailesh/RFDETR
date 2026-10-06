import type { TiledData, TiledFile } from "./types";

export interface DatasetItem {
  image: TiledFile;
  label: TiledFile;
  split: "train" | "valid";
}

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
        if (tiled.preserveFilenames) throw new Error(`Missing annotation for ${image.name}`);
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

import type { SplitFile, TiledData, TiledFile } from "./types";
import { sanitizeSmallBoxThreshold, sanitizeMinRetainedPercentage, sanitizeSliverValue } from "./tiling-settings";
import {
  TILES,
  TILE_SUFFIXES,
  tileImageBlob,
  recomputeAnnotationTextForTile,
  type TileRange,
  type SliverFilterOptions,
} from "./tiling";

export interface TilingProgress {
  current: number;
  total: number;
  imageName: string;
}

function getBaseName(filename: string): string {
  const dot = filename.lastIndexOf(".");
  return dot >= 0 ? filename.substring(0, dot) : filename;
}

async function tileOneImage(
  imageFile: SplitFile,
  labelFile: SplitFile,
  onProgress?: (p: TilingProgress) => void,
  current?: number,
  total?: number,
  smallBoxThreshold = 0,
  onSmallBoxRemoved?: () => void,
  minRetainedPercentage = 0,
  onClippedFragmentRemoved?: () => void,
  sliver: SliverFilterOptions = {},
): Promise<{ images: TiledFile[]; labels: TiledFile[] }> {
  const images: TiledFile[] = [];
  const labels: TiledFile[] = [];
  const labelText = await labelFile.blob.text();
  const baseName = getBaseName(imageFile.name);

  for (let i = 0; i < TILES.length; i++) {
    const tile: TileRange = TILES[i];
    const suffix = TILE_SUFFIXES[i];

    if (onProgress && current !== undefined && total !== undefined) {
      onProgress({ current, total, imageName: `${imageFile.name} (tile ${i + 1}/2)` });
    }

    const tileBlob = await tileImageBlob(imageFile.blob, tile);
    images.push({ name: `${baseName}${suffix}.jpg`, blob: tileBlob });

    const recomputedText = recomputeAnnotationTextForTile(labelText, tile, smallBoxThreshold, onSmallBoxRemoved, minRetainedPercentage, onClippedFragmentRemoved, sliver);
    labels.push({
      name: `${baseName}${suffix}.txt`,
      blob: new Blob([recomputedText], { type: "text/plain" }),
    });
  }

  return { images, labels };
}

export async function runTiling(
  trainImages: SplitFile[],
  trainLabels: SplitFile[],
  validImages: SplitFile[],
  validLabels: SplitFile[],
  onProgress?: (p: TilingProgress) => void,
  smallBoxThreshold = 0,
  minRetainedPercentage = 0,
  sliverMinSide = 0,
  sliverAspectRatio = 0,
): Promise<TiledData> {
  const threshold = sanitizeSmallBoxThreshold(smallBoxThreshold);
  const smallBoxesRemoved = { train: 0, valid: 0 };
  const retainedThreshold = sanitizeMinRetainedPercentage(minRetainedPercentage);
  const clippedFragmentsRemoved = { train: 0, valid: 0 };
  const sliverSettings = { sliverMinSide: sanitizeSliverValue(sliverMinSide), sliverAspectRatio: sanitizeSliverValue(sliverAspectRatio) };
  const sliverBoxesRemoved = { train: 0, valid: 0 };
  const totalImages = trainImages.length + validImages.length;
  let current = 0;

  const trainTiledImages: TiledFile[] = [];
  const trainTiledLabels: TiledFile[] = [];
  const validTiledImages: TiledFile[] = [];
  const validTiledLabels: TiledFile[] = [];

  for (let i = 0; i < trainImages.length; i++) {
    if (onProgress) onProgress({ current, total: totalImages, imageName: trainImages[i].name });
    const result = await tileOneImage(
      trainImages[i],
      trainLabels[i],
      onProgress,
      current,
      totalImages,
      threshold,
      () => { smallBoxesRemoved.train++; },
      retainedThreshold,
      () => { clippedFragmentsRemoved.train++; },
      { ...sliverSettings, onRemoved: () => { sliverBoxesRemoved.train++; } },
    );
    trainTiledImages.push(...result.images);
    trainTiledLabels.push(...result.labels);
    current++;
  }

  for (let i = 0; i < validImages.length; i++) {
    if (onProgress) onProgress({ current, total: totalImages, imageName: validImages[i].name });
    const result = await tileOneImage(
      validImages[i],
      validLabels[i],
      onProgress,
      current,
      totalImages,
      threshold,
      () => { smallBoxesRemoved.valid++; },
      retainedThreshold,
      () => { clippedFragmentsRemoved.valid++; },
      { ...sliverSettings, onRemoved: () => { sliverBoxesRemoved.valid++; } },
    );
    validTiledImages.push(...result.images);
    validTiledLabels.push(...result.labels);
    current++;
  }

  return {
    ...sliverSettings,
    sliverBoxesRemoved,
    smallBoxThreshold: threshold,
    smallBoxesRemoved,
    minRetainedPercentage: retainedThreshold,
    clippedFragmentsRemoved,
    trainImages: trainTiledImages,
    trainLabels: trainTiledLabels,
    validImages: validTiledImages,
    validLabels: validTiledLabels,
    tiledAt: Date.now(),
  };
}

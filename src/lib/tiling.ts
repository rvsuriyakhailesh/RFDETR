import { sanitizeSmallBoxThreshold, sanitizeMinRetainedPercentage } from "./tiling-settings";

export interface YoloLine {
  cls: number;
  xCenter: number;
  yCenter: number;
  width: number;
  height: number;
}

export interface TileRange {
  xMin: number;
  xMax: number;
}

export interface RecomputedLine {
  cls: number;
  xCenter: number;
  yCenter: number;
  width: number;
  height: number;
}

export const IMAGE_WIDTH = 2560;
export const IMAGE_HEIGHT = 1440;
export const TILE_SIZE = 1440;

export const TILE_0: TileRange = { xMin: 0, xMax: 1440 };
export const TILE_1: TileRange = { xMin: 1120, xMax: 2560 };

export const TILES: TileRange[] = [TILE_0, TILE_1];
export const TILE_SUFFIXES = ["_1", "_2"];

export function parseYoloLine(line: string): YoloLine | null {
  const parts = line.trim().split(/\s+/);
  if (parts.length < 5) return null;
  const cls = parseInt(parts[0], 10);
  const xCenter = parseFloat(parts[1]);
  const yCenter = parseFloat(parts[2]);
  const width = parseFloat(parts[3]);
  const height = parseFloat(parts[4]);
  if (
    Number.isNaN(cls) ||
    Number.isNaN(xCenter) ||
    Number.isNaN(yCenter) ||
    Number.isNaN(width) ||
    Number.isNaN(height)
  ) {
    return null;
  }
  return { cls, xCenter, yCenter, width, height };
}

export function parseYoloText(text: string): YoloLine[] {
  const lines: YoloLine[] = [];
  for (const raw of text.split("\n")) {
    const parsed = parseYoloLine(raw);
    if (parsed) lines.push(parsed);
  }
  return lines;
}

export function formatYoloLine(line: RecomputedLine): string {
  return `${line.cls} ${line.xCenter.toFixed(6)} ${line.yCenter.toFixed(6)} ${line.width.toFixed(6)} ${line.height.toFixed(6)}`;
}

export function recomputeAnnotationForTile(
  line: YoloLine,
  tile: TileRange,
  smallBoxThreshold = 0,
  onSmallBoxRemoved?: () => void,
  minRetainedPercentage = 0,
  onClippedFragmentRemoved?: () => void,
): RecomputedLine | null {
  const boxLeft = line.xCenter * IMAGE_WIDTH - (line.width * IMAGE_WIDTH) / 2;
  const boxRight = line.xCenter * IMAGE_WIDTH + (line.width * IMAGE_WIDTH) / 2;
  const boxTop = line.yCenter * IMAGE_HEIGHT - (line.height * IMAGE_HEIGHT) / 2;
  const boxBottom = line.yCenter * IMAGE_HEIGHT + (line.height * IMAGE_HEIGHT) / 2;
  const originalArea = (boxRight - boxLeft) * (boxBottom - boxTop);
  if (![boxLeft, boxRight, boxTop, boxBottom, originalArea].every(Number.isFinite) || originalArea <= 0) return null;

  const clipLeft = Math.max(boxLeft, tile.xMin);
  const clipRight = Math.min(boxRight, tile.xMax);
  const clipTop = Math.max(boxTop, 0);
  const clipBottom = Math.min(boxBottom, IMAGE_HEIGHT);

  if (clipRight <= clipLeft || clipBottom <= clipTop) return null;

  const area = (clipRight - clipLeft) * (clipBottom - clipTop);
  const threshold = sanitizeSmallBoxThreshold(smallBoxThreshold);
  // Preserve equality despite roundoff when converting normalized coordinates
  // back to pixels. This tolerance is far below a pixel of area.
  const roundoff = Number.EPSILON * Math.max(area, threshold) * 16;
  if (threshold > 0 && area < threshold && threshold - area > roundoff) {
    onSmallBoxRemoved?.();
    return null;
  }

  const wasClipped = clipLeft !== boxLeft || clipRight !== boxRight ||
    clipTop !== boxTop || clipBottom !== boxBottom;
  const retainedThreshold = sanitizeMinRetainedPercentage(minRetainedPercentage);
  if (wasClipped && retainedThreshold > 0) {
    const retainedPercentage = area / originalArea * 100;
    const percentageRoundoff = Number.EPSILON * Math.max(retainedPercentage, retainedThreshold) * 16;
    if (retainedPercentage < retainedThreshold && retainedThreshold - retainedPercentage > percentageRoundoff) {
      onClippedFragmentRemoved?.();
      return null;
    }
  }

  const newXCenter = (clipLeft + clipRight) / 2 - tile.xMin;
  const newWidth = clipRight - clipLeft;
  const newYCenter = (clipTop + clipBottom) / 2;
  const newHeight = clipBottom - clipTop;

  return {
    cls: line.cls,
    xCenter: newXCenter / TILE_SIZE,
    yCenter: newYCenter / IMAGE_HEIGHT,
    width: newWidth / TILE_SIZE,
    height: newHeight / IMAGE_HEIGHT,
  };
}

export function recomputeAnnotationsForTile(
  lines: YoloLine[],
  tile: TileRange,
  smallBoxThreshold = 0,
  onSmallBoxRemoved?: () => void,
  minRetainedPercentage = 0,
  onClippedFragmentRemoved?: () => void,
): RecomputedLine[] {
  const result: RecomputedLine[] = [];
  for (const line of lines) {
    const recomputed = recomputeAnnotationForTile(line, tile, smallBoxThreshold, onSmallBoxRemoved, minRetainedPercentage, onClippedFragmentRemoved);
    if (recomputed) result.push(recomputed);
  }
  return result;
}

export function recomputeAnnotationTextForTile(
  text: string,
  tile: TileRange,
  smallBoxThreshold = 0,
  onSmallBoxRemoved?: () => void,
  minRetainedPercentage = 0,
  onClippedFragmentRemoved?: () => void,
): string {
  const lines = parseYoloText(text);
  const recomputed = recomputeAnnotationsForTile(lines, tile, smallBoxThreshold, onSmallBoxRemoved, minRetainedPercentage, onClippedFragmentRemoved);
  return recomputed.map(formatYoloLine).join("\n");
}

export function getTileBaseName(imageName: string): string {
  const dot = imageName.lastIndexOf(".");
  return dot >= 0 ? imageName.substring(0, dot) : imageName;
}

export function getTileImageName(imageName: string, tileIndex: number): string {
  const base = getTileBaseName(imageName);
  return `${base}${TILE_SUFFIXES[tileIndex]}.jpg`;
}

export function getTileLabelName(labelName: string, tileIndex: number): string {
  const dot = labelName.lastIndexOf(".");
  const base = dot >= 0 ? labelName.substring(0, dot) : labelName;
  return `${base}${TILE_SUFFIXES[tileIndex]}.txt`;
}

export async function tileImageBlob(
  blob: Blob,
  tile: TileRange,
): Promise<Blob> {
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement("canvas");
  canvas.width = TILE_SIZE;
  canvas.height = IMAGE_HEIGHT;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Failed to get canvas 2d context");
  ctx.drawImage(
    bitmap,
    tile.xMin,
    0,
    TILE_SIZE,
    IMAGE_HEIGHT,
    0,
    0,
    TILE_SIZE,
    IMAGE_HEIGHT,
  );
  bitmap.close();
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (result) => {
        if (result) resolve(result);
        else reject(new Error("Failed to produce JPEG blob"));
      },
      "image/jpeg",
      0.92,
    );
  });
}

export async function tileImage(
  blob: Blob,
): Promise<{ blob: Blob; tile: TileRange }[]> {
  const results: { blob: Blob; tile: TileRange }[] = [];
  for (const tile of TILES) {
    const tileBlob = await tileImageBlob(blob, tile);
    results.push({ blob: tileBlob, tile });
  }
  return results;
}

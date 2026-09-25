import { sanitizeSmallBoxThreshold, sanitizeMinRetainedPercentage, sanitizeSliverValue } from "./tiling-settings";

export interface SliverFilterOptions {
  sliverMinSide?: number;
  sliverAspectRatio?: number;
  onRemoved?: () => void;
}

function strictlyBelow(value: number, threshold: number): boolean {
  return threshold - value > Number.EPSILON * Math.max(1, Math.abs(value), Math.abs(threshold)) * 16;
}

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

const DECIMAL = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i;
const BOUNDARY_ROUNDOFF = 0.000001;

function parseYoloLineDetailed(line: string, classCount?: number, requireBounds = false): { value: YoloLine | null; reason: string | null } {
  const parts = line.trim().split(/\s+/);
  if (parts.length !== 5) return { value: null, reason: "Expected exactly five fields: class, x center, y center, width, height." };
  if (!/^\d+$/.test(parts[0]) || !Number.isSafeInteger(Number(parts[0]))) {
    return { value: null, reason: "Class ID must be a nonnegative integer." };
  }
  const cls = Number(parts[0]);
  if (classCount !== undefined && cls >= classCount) {
    return { value: null, reason: `Class ID ${cls} is outside obj.names (0-${classCount - 1}).` };
  }
  if (parts.slice(1).some((part) => !DECIMAL.test(part))) {
    return { value: null, reason: "Coordinates and dimensions must be valid numbers." };
  }
  const [xCenter, yCenter, width, height] = parts.slice(1).map(Number);
  if (![xCenter, yCenter, width, height].every(Number.isFinite)) {
    return { value: null, reason: "Coordinates and dimensions must be finite." };
  }
  if (width <= 0 || height <= 0 || width > 1 || height > 1) {
    return { value: null, reason: "Width and height must be greater than zero and at most one." };
  }
  if (requireBounds && (xCenter < 0 || xCenter > 1 || yCenter < 0 || yCenter > 1 ||
      xCenter - width / 2 < -BOUNDARY_ROUNDOFF || xCenter + width / 2 > 1 + BOUNDARY_ROUNDOFF ||
      yCenter - height / 2 < -BOUNDARY_ROUNDOFF || yCenter + height / 2 > 1 + BOUNDARY_ROUNDOFF)) {
    return { value: null, reason: "Bounding box extends outside normalized image coordinates." };
  }
  return { value: { cls, xCenter, yCenter, width, height }, reason: null };
}

export function parseYoloLine(line: string): YoloLine | null {
  return parseYoloLineDetailed(line).value;
}

export function validateYoloText(text: string, classCount?: number): { lineNumber: number; reason: string }[] {
  const issues: { lineNumber: number; reason: string }[] = [];
  text.split(/\r?\n/).forEach((raw, index) => {
    if (!raw.trim()) return;
    const { reason } = parseYoloLineDetailed(raw, classCount, true);
    if (reason) issues.push({ lineNumber: index + 1, reason });
  });
  return issues;
}

export function parseYoloText(text: string): YoloLine[] {
  const lines: YoloLine[] = [];
  text.split(/\r?\n/).forEach((raw, index) => {
    if (!raw.trim()) return;
    const { value, reason } = parseYoloLineDetailed(raw);
    if (reason || !value) throw new Error(`Annotation line ${index + 1}: ${reason}`);
    lines.push(value);
  });
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
  sliver: SliverFilterOptions = {},
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

  const coordinateEpsilon = Number.EPSILON * Math.max(IMAGE_WIDTH, IMAGE_HEIGHT,
    Math.abs(boxLeft), Math.abs(boxRight), Math.abs(boxTop), Math.abs(boxBottom)) * 16;
  const wasClipped = Math.abs(clipLeft - boxLeft) > coordinateEpsilon ||
    Math.abs(clipRight - boxRight) > coordinateEpsilon ||
    Math.abs(clipTop - boxTop) > coordinateEpsilon ||
    Math.abs(clipBottom - boxBottom) > coordinateEpsilon;
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

  const minSide = Math.min(newWidth, newHeight);
  const aspectRatio = Math.max(newWidth, newHeight) / minSide;
  const sliverMinSide = sanitizeSliverValue(sliver.sliverMinSide);
  const sliverAspectRatio = sanitizeSliverValue(sliver.sliverAspectRatio);
  if (wasClipped && sliverMinSide > 0 && sliverAspectRatio > 0 &&
      strictlyBelow(minSide, sliverMinSide) && strictlyBelow(sliverAspectRatio, aspectRatio)) {
    sliver.onRemoved?.();
    return null;
  }

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
  sliver: SliverFilterOptions = {},
): RecomputedLine[] {
  const result: RecomputedLine[] = [];
  for (const line of lines) {
    const recomputed = recomputeAnnotationForTile(line, tile, smallBoxThreshold, onSmallBoxRemoved, minRetainedPercentage, onClippedFragmentRemoved, sliver);
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
  sliver: SliverFilterOptions = {},
): string {
  const lines = parseYoloText(text);
  const recomputed = recomputeAnnotationsForTile(lines, tile, smallBoxThreshold, onSmallBoxRemoved, minRetainedPercentage, onClippedFragmentRemoved, sliver);
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

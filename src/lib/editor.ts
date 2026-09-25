import type { YoloLine } from "./tiling";

export interface Point { x: number; y: number }
export interface Rect { left: number; top: number; right: number; bottom: number }

/** True only when a nonzero segment enters the open interior of a rectangle. */
export function segmentCrossesRectInterior(start: Point, end: Point, rect: Rect): boolean {
  if (rect.left >= rect.right || rect.top >= rect.bottom) return false;
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (dx === 0 && dy === 0) return false;
  let lower = 0;
  let upper = 1;
  for (const [origin, delta, min, max] of [
    [start.x, dx, rect.left, rect.right],
    [start.y, dy, rect.top, rect.bottom],
  ]) {
    if (delta === 0) {
      if (origin <= min || origin >= max) return false;
      continue;
    }
    const first = (min - origin) / delta;
    const second = (max - origin) / delta;
    lower = Math.max(lower, Math.min(first, second));
    upper = Math.min(upper, Math.max(first, second));
    if (lower >= upper) return false;
  }
  return lower < upper;
}

export function selectBoxesCrossedByLine(
  boxes: YoloLine[], start: Point, end: Point, isVisible: (cls: number) => boolean,
): Set<number> {
  const selected = new Set<number>();
  boxes.forEach((box, index) => {
    if (isVisible(box.cls) && segmentCrossesRectInterior(start, end, {
      left: box.xCenter - box.width / 2,
      right: box.xCenter + box.width / 2,
      top: box.yCenter - box.height / 2,
      bottom: box.yCenter + box.height / 2,
    })) selected.add(index);
  });
  return selected;
}

/** Move a copied group under the pointer while retaining every box's size and class. */
export function pasteBoxesAtPosition(boxes: YoloLine[], x: number, y: number): YoloLine[] | null {
  if (boxes.length === 0 || ![x, y].every(Number.isFinite)) return null;
  const left = Math.min(...boxes.map((box) => box.xCenter - box.width / 2));
  const right = Math.max(...boxes.map((box) => box.xCenter + box.width / 2));
  const top = Math.min(...boxes.map((box) => box.yCenter - box.height / 2));
  const bottom = Math.max(...boxes.map((box) => box.yCenter + box.height / 2));
  if (!boxes.every((box) => [box.xCenter, box.yCenter, box.width, box.height].every(Number.isFinite) && box.width > 0 && box.height > 0) ||
      right - left > 1 || bottom - top > 1) return null;
  const dx = Math.max(-left, Math.min(1 - right, x - (left + right) / 2));
  const dy = Math.max(-top, Math.min(1 - bottom, y - (top + bottom) / 2));
  return boxes.map((box) => ({ ...box, xCenter: box.xCenter + dx, yCenter: box.yCenter + dy }));
}

export function imageNumberToIndex(value: string, count: number): number | null {
  if (!/^\d+$/.test(value.trim())) return null;
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 1 && number <= count
    ? number - 1
    : null;
}

export function moveSelectedBoxes(
  original: YoloLine[], selected: ReadonlySet<number>, dx: number, dy: number,
): YoloLine[] {
  let minX = -Infinity, maxX = Infinity, minY = -Infinity, maxY = Infinity;
  for (const index of selected) {
    const box = original[index];
    if (!box) continue;
    minX = Math.max(minX, box.width / 2 - box.xCenter);
    maxX = Math.min(maxX, 1 - box.width / 2 - box.xCenter);
    minY = Math.max(minY, box.height / 2 - box.yCenter);
    maxY = Math.min(maxY, 1 - box.height / 2 - box.yCenter);
  }
  const x = Math.max(minX, Math.min(maxX, dx));
  const y = Math.max(minY, Math.min(maxY, dy));
  if (x === 0 && y === 0) return original;
  return original.map((box, index) => selected.has(index)
    ? { ...box, xCenter: box.xCenter + x, yCenter: box.yCenter + y }
    : box);
}

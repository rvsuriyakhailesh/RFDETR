import type { YoloLine } from "./tiling";

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

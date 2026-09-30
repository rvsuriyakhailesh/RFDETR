export const DEFAULT_SMALL_BOX_THRESHOLD = 0;
export const DEFAULT_MIN_RETAINED_PERCENTAGE = 10;
export const DEFAULT_SLIVER_MIN_SIDE = 40;
export const DEFAULT_SLIVER_ASPECT_RATIO = 3;

export function sanitizeSliverValue(value: unknown): number {
  if (typeof value !== "number" && typeof value !== "string") return 0;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : 0;
}

export function sanitizeMinRetainedPercentage(value: unknown): number {
  if (typeof value !== "number" && typeof value !== "string") return 0;
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(100, Math.max(0, number)) : 0;
}

/** Invalid/empty input disables filtering; never pass NaN into the pipeline. */
export function sanitizeSmallBoxThreshold(value: unknown): number {
  if (typeof value !== "number" && typeof value !== "string") return 0;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.floor(number) : 0;
}

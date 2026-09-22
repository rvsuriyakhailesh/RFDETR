import type { ValidationIssue } from "./types";

const stem = (name: string) => name.slice(0, name.lastIndexOf("."));

/** Plan all renames together; never repair mismatched pairs or partially rename. */
export function normalizeNumericFilenames(
  imageNames: string[],
  annotationNames: string[],
): { imageNames: string[]; annotationNames: string[]; issues: ValidationIssue[] } {
  const unchanged = { imageNames, annotationNames, issues: [] as ValidationIssue[] };
  if (imageNames.length === 0 || annotationNames.length === 0) return unchanged;
  const names = [...imageNames, ...annotationNames];
  if (!names.every((name) => /^\d+$/.test(stem(name)))) return unchanged;

  const width = names.reduce((max, name) => Math.max(max, stem(name).length), 3);
  const padded = (name: string) => stem(name).padStart(width, "0") + name.slice(name.lastIndexOf("."));
  const images = imageNames.map(padded);
  const annotations = annotationNames.map(padded);
  const issues: ValidationIssue[] = [];

  // Unique stems are required too: different image extensions still produce
  // the same annotation and tiled output names downstream.
  for (const [original, normalized, kind] of [
    [imageNames, images, "image"],
    [annotationNames, annotations, "annotation"],
  ] as const) {
    const seen = new Map<string, string>();
    normalized.forEach((name, index) => {
      const key = stem(name);
      const previous = seen.get(key);
      if (previous !== undefined) {
        issues.push({
          type: "duplicate-filename",
          filename: original[index],
          reason: `Numeric filename normalization would give ${kind} files '${previous}' and '${original[index]}' the same stem '${key}'. No files were renamed.`,
        });
      }
      seen.set(key, original[index]);
    });
  }
  if (issues.length > 0) return { ...unchanged, issues };

  const imageStems = new Set(imageNames.map(stem));
  const annotationStems = new Set(annotationNames.map(stem));
  if (imageStems.size !== annotationStems.size ||
      [...imageStems].some((name) => !annotationStems.has(name))) {
    // Leave original filenames intact so existing orphan validation reports
    // mismatches such as 01.jpg / 1.txt instead of silently accepting them.
    return unchanged;
  }

  return { imageNames: images, annotationNames: annotations, issues };
}

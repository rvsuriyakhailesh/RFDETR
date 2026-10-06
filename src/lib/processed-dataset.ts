import JSZip from "jszip";
import type { DatasetType, TiledData, ValidationIssue, ValidatedSession } from "./types";
import { getImageDimensions } from "./validation";
import { validateYoloText } from "./tiling";
import { orderedDatasetItems } from "./dataset-items";

const folders = ["train/images", "train/labels", "valid/images", "valid/labels"];
const imagePattern = /\.(jpg|jpeg|png|bmp|tif|tiff)$/i;

/** Partial output signatures are invalid, never a fallback to raw validation. */
export function detectDatasetType(files: readonly string[]): DatasetType {
  const paths = files.filter(path => !path.startsWith("__MACOSX/"));
  const looksProcessed = paths.some(path => /^RFDETR_[^/]+(?:\/|$)/.test(path)
    || /(?:^|\/)(train|valid)\/(images|labels)(?:\/|$)/.test(path));
  if (!looksProcessed) {
    return paths.some(path => /^(data\/|obj_train_data\/|obj\.names$)/.test(path)) ? "raw" : "invalid";
  }
  const roots = new Set(paths.map(path => path.split("/")[0]));
  if (roots.size !== 1) return "invalid";
  const root = [...roots][0];
  if (!/^RFDETR_.+/.test(root)) return "invalid";
  if (!paths.includes(`${root}/${root}_obj.names`)) return "invalid";
  return folders.every(folder => paths.some(path => path === `${root}/${folder}/`
    || path.startsWith(`${root}/${folder}/`))) ? "processed-rfdetr" : "invalid";
}

// JSZip coalesces identical central-directory names. Inspect those names before loading.
function checkArchivePaths(buffer: ArrayBuffer): void {
  const view = new DataView(buffer);
  let end = view.byteLength - 22;
  const earliest = Math.max(0, end - 65535);
  while (end >= earliest && (view.getUint32(end, true) !== 0x06054b50
    || end + 22 + view.getUint16(end + 20, true) !== view.byteLength)) end--;
  if (end < earliest) throw new Error("Could not read ZIP directory. The archive may be corrupted.");
  const count = view.getUint16(end + 10, true);
  let offset = view.getUint32(end + 16, true);
  if (count === 65535 || offset === 0xffffffff) throw new Error("ZIP64 archives are not supported by this importer.");
  const seen = new Set<string>();
  const decoder = new TextDecoder();
  for (let i = 0; i < count; i++) {
    if (offset + 46 > end || view.getUint32(offset, true) !== 0x02014b50) throw new Error("Corrupt ZIP directory.");
    const length = view.getUint16(offset + 28, true);
    const next = offset + 46 + length + view.getUint16(offset + 30, true) + view.getUint16(offset + 32, true);
    if (next > end) throw new Error("Corrupt ZIP directory.");
    const path = decoder.decode(new Uint8Array(buffer, offset + 46, length));
    if (seen.has(path)) throw new Error(`Duplicate ZIP path: ${path}`);
    if (path.includes("\\") || path.startsWith("/") || path.split("/").some(part => part === "." || part === "..")) {
      throw new Error(`Unsafe or conflicting ZIP path: ${path}`);
    }
    seen.add(path);
    offset = next;
  }
}

export async function loadProcessedDataset(file: Blob): Promise<{
  issues: ValidationIssue[];
  session: ValidatedSession | null;
  tiled: TiledData | null;
}> {
  const issues: ValidationIssue[] = [];
  const fail = (filename: string, reason: string, type: ValidationIssue["type"] = "zip-structure") => {
    issues.push({ filename, reason, type });
  };
  let zip: JSZip;
  try {
    const buffer = await file.arrayBuffer();
    checkArchivePaths(buffer);
    zip = await JSZip.loadAsync(buffer);
  } catch (error) {
    fail("ZIP", error instanceof Error ? error.message : "Could not read ZIP.");
    return { issues, session: null, tiled: null };
  }
  const paths = Object.keys(zip.files).filter(path => !path.startsWith("__MACOSX/"));
  const type = detectDatasetType(paths);
  const roots = [...new Set(paths.map(path => path.split("/")[0]))];
  const root = roots[0] ?? "";
  if (type !== "processed-rfdetr") {
    if (roots.length === 1 && /^RFDETR_.+/.test(root)) {
      for (const folder of folders) {
        if (!paths.some(path => path.startsWith(`${root}/${folder}/`))) {
          fail(folder, `Processed RFDETR dataset detected, but the ${folder.replace("/", " ")} folder is missing.`);
        }
      }
      if (!zip.file(`${root}/${root}_obj.names`)) fail(root, "Processed RFDETR dataset is missing its class names file.");
    }
    if (!issues.length) fail("ZIP", type === "raw"
      ? "Raw datasets require the original image and annotation ZIP pair. Select both files."
      : "Expected one RFDETR_<name> root with its class names file and train/valid images and labels folders.");
    return { issues, session: null, tiled: null };
  }
  const namesText = await zip.file(`${root}/${root}_obj.names`)!.async("string");
  const classCount = namesText.trim() ? namesText.trim().split(/\r?\n/).length : 0;
  if (!classCount) fail(`${root}_obj.names`, "Class names must define at least one class.", "invalid-annotation");
  const tiled: TiledData = {
    preserveFilenames: true, trainImages: [], trainLabels: [], validImages: [], validLabels: [], tiledAt: Date.now(),
  };
  const seenBases = new Set<string>();
  for (const path of paths) {
    if (zip.files[path].dir || path === `${root}/${root}_obj.names`) continue;
    const match = path.match(/^RFDETR_[^/]+\/(train|valid)\/(images|labels)\/([^/]+)$/);
    if (!match || (match[2] === "images" ? !imagePattern.test(match[3]) : !match[3].endsWith(".txt"))) {
      fail(path, "Unexpected file in processed RFDETR dataset.");
    }
  }
  for (const split of ["train", "valid"] as const) {
    const imagePrefix = `${root}/${split}/images/`;
    const labelPrefix = `${root}/${split}/labels/`;
    const images = paths.filter(path => !zip.files[path].dir && path.startsWith(imagePrefix) && imagePattern.test(path));
    const labelPaths = new Set(paths.filter(path => !zip.files[path].dir && path.startsWith(labelPrefix)));
    for (const path of images) {
      const name = path.slice(imagePrefix.length);
      const base = name.replace(/\.[^.]+$/, "");
      // A global basename is the identity used by editor navigation and split reassignment.
      const identity = base.toLowerCase();
      if (seenBases.has(identity)) fail(path, "Duplicate/conflicting image basename across Train/Valid.", "duplicate-filename");
      seenBases.add(identity);
      const labelPath = `${labelPrefix}${base}.txt`;
      if (!labelPaths.delete(labelPath)) {
        fail(path, "Missing matching annotation in the same partition.", "orphaned-image");
        continue;
      }
      try {
        const blob = await zip.files[path].async("blob");
        const dimensions = await getImageDimensions(blob);
        if (dimensions.width <= 0 || dimensions.height <= 0) throw new Error("Image has no readable pixels.");
        const labelBlob = await zip.files[labelPath].async("blob");
        const text = await labelBlob.text();
        for (const issue of validateYoloText(text, classCount)) {
          fail(labelPath, `Line ${issue.lineNumber}: ${issue.reason}`, "invalid-annotation");
        }
        tiled[split === "train" ? "trainImages" : "validImages"].push({ name, blob });
        tiled[split === "train" ? "trainLabels" : "validLabels"].push({ name: `${base}.txt`, blob: labelBlob });
      } catch (error) {
        fail(path, `Could not load image/label pair: ${error instanceof Error ? error.message : "corrupt file"}`);
      }
    }
    for (const path of labelPaths) fail(path, "No matching image in the same partition.", "orphaned-annotation");
  }
  if (!tiled.trainImages.length) fail("train/images", "At least one Train image is required.");
  if (issues.length) return { issues, session: null, tiled: null };
  const count = orderedDatasetItems(tiled).length;
  return {
    issues, tiled,
    session: {
      datasetType: "processed-rfdetr", zipBaseName: root.slice("RFDETR_".length),
      objNames: { name: `${root}_obj.names`, text: namesText }, pairs: [],
      totalImages: count, totalAnnotations: count, validatedAt: Date.now(),
    },
  };
}

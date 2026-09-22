import JSZip from "jszip";
import type { TiledData, TiledFile } from "./types";
import { parseYoloText } from "./tiling";

export const ZIP_VERSION = 2;

export interface FinalSummary {
  totalImages: number;
  totalAnnotations: number;
  annotationsPerClass: Map<number, number>;
  classNames: string[];
  unsavedImages: string[];
}

export async function computeFinalSummaryAsync(
  tiled: TiledData,
  classNames: string[],
): Promise<FinalSummary> {
  const allLabels = [...tiled.trainLabels, ...tiled.validLabels];
  const allImages = [...tiled.trainImages, ...tiled.validImages];

  const annotationsPerClass = new Map<number, number>();
  let totalAnnotations = 0;

  for (const label of allLabels) {
    const text = await label.blob.text();
    const lines = parseYoloText(text);
    totalAnnotations += lines.length;
    for (const line of lines) {
      annotationsPerClass.set(line.cls, (annotationsPerClass.get(line.cls) ?? 0) + 1);
    }
  }

  return {
    totalImages: allImages.length,
    totalAnnotations,
    annotationsPerClass,
    classNames,
    unsavedImages: [],
  };
}

function ensurePrefixed(name: string, prefix: string): string {
  if (name.startsWith(prefix)) return name;
  return `${prefix}${name}`;
}

export interface ZipBuildProgress {
  current: number;
  total: number;
  fileName: string;
}

export async function buildFinalZip(
  tiled: TiledData,
  objNamesText: string,
  folderName: string,
  onProgress?: (p: ZipBuildProgress) => void,
): Promise<Blob> {
  const zip = new JSZip();
  const rootFolderName = `RFDETR_${folderName}`;
  const root = zip.folder(rootFolderName);
  if (!root) throw new Error("Failed to create root folder in zip");

  root.file(`${rootFolderName}_obj.names`, objNamesText);

  const prefix = `${folderName}_`;

  const trainImages = root.folder("train")!.folder("images")!;
  const trainLabels = root.folder("train")!.folder("labels")!;
  const validImages = root.folder("valid")!.folder("images")!;
  const validLabels = root.folder("valid")!.folder("labels")!;

  const allFiles: { file: TiledFile; target: JSZip }[] = [];

  for (const f of tiled.trainImages) allFiles.push({ file: f, target: trainImages });
  for (const f of tiled.trainLabels) allFiles.push({ file: f, target: trainLabels });
  for (const f of tiled.validImages) allFiles.push({ file: f, target: validImages });
  for (const f of tiled.validLabels) allFiles.push({ file: f, target: validLabels });

  const total = allFiles.length;
  for (let i = 0; i < allFiles.length; i++) {
    const { file, target } = allFiles[i];
    const prefixedName = ensurePrefixed(file.name, prefix);
    if (onProgress) {
      onProgress({ current: i, total, fileName: prefixedName });
    }
    target.file(prefixedName, file.blob);
  }

  if (onProgress) {
    onProgress({ current: total, total, fileName: "Compressing..." });
  }

  return zip.generateAsync({ type: "blob", compression: "DEFLATE" });
}

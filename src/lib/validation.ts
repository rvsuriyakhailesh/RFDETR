import JSZip from "jszip";
import { normalizeNumericFilenames } from "./filename-normalization";
import { validateYoloText } from "./tiling";
import type {
  ValidationIssue,
  ImageFile,
  AnnotationFile,
  ObjNamesFile,
  ValidatedPair,
  ValidatedSession,
} from "./types";

const IMAGE_EXTENSIONS = [".jpg", ".jpeg", ".png", ".bmp", ".tif", ".tiff"];
const EXPECTED_WIDTH = 2560;
const EXPECTED_HEIGHT = 1440;

function getBaseName(filename: string): string {
  const dot = filename.lastIndexOf(".");
  return dot >= 0 ? filename.substring(0, dot) : filename;
}

function getExtension(filename: string): string {
  const dot = filename.lastIndexOf(".");
  return dot >= 0 ? filename.substring(dot).toLowerCase() : "";
}

function isImageFile(filename: string): boolean {
  return IMAGE_EXTENSIONS.includes(getExtension(filename));
}

function isTxtFile(filename: string): boolean {
  return getExtension(filename) === ".txt";
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\.\//, "");
}

function getFolder(path: string): string {
  const normalized = normalizePath(path);
  const slash = normalized.indexOf("/");
  return slash >= 0 ? normalized.substring(0, slash) : "";
}

function stripFolder(path: string, folder: string): string {
  const normalized = normalizePath(path);
  const prefix = folder + "/";
  if (normalized.startsWith(prefix)) {
    return normalized.substring(prefix.length);
  }
  return normalized;
}

function getImageDimensions(blob: Blob): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Failed to load image"));
    };
    img.src = url;
  });
}

function determineZipNames(
  name1: string,
  name2: string,
): { backupName: string; nonBackupName: string; baseName: string } | null {
  const stripExt = (n: string) => {
    const dot = n.lastIndexOf(".");
    return dot >= 0 ? n.substring(0, dot) : n;
  };
  const base1 = stripExt(name1);
  const base2 = stripExt(name2);

  if (base1.endsWith("_backup") && base2 === base1.replace(/_backup$/, "")) {
    return { backupName: name1, nonBackupName: name2, baseName: base2 };
  }
  if (base2.endsWith("_backup") && base1 === base2.replace(/_backup$/, "")) {
    return { backupName: name2, nonBackupName: name1, baseName: base1 };
  }
  return null;
}

export interface ValidationResult {
  issues: ValidationIssue[];
  session: ValidatedSession | null;
}

export async function validateZipFiles(
  file1: File,
  file2: File,
): Promise<ValidationResult> {
  const issues: ValidationIssue[] = [];

  const zipNames = determineZipNames(file1.name, file2.name);
  if (!zipNames) {
    issues.push({
      type: "filename-mismatch",
      filename: `${file1.name}, ${file2.name}`,
      reason:
        "The two zip files must differ only by a '_backup' suffix (e.g. 'abc_xyz_backup.zip' and 'abc_xyz.zip').",
    });
    return { issues, session: null };
  }

  const { backupName, nonBackupName, baseName } = zipNames;

  let backupZip: JSZip;
  let nonBackupZip: JSZip;

  try {
    const backupFile = backupName === file1.name ? file1 : file2;
    backupZip = await JSZip.loadAsync(backupFile);
  const nonBackupFile = nonBackupName === file1.name ? file1 : file2;
    nonBackupZip = await JSZip.loadAsync(nonBackupFile);
  } catch (err) {
    issues.push({
      type: "zip-structure",
      filename: (err instanceof Error ? err.message : String(err)).includes(backupName)
        ? backupName
        : nonBackupName,
      reason: "Could not read this zip file. It may be corrupted.",
    });
    return { issues, session: null };
  }

  const backupEntries = Object.values(backupZip.files).filter(
    (f) => !f.dir,
  );
  const nonBackupEntries = Object.values(nonBackupZip.files).filter(
    (f) => !f.dir,
  );

  const dataFolder = "data";
  const objTrainFolder = "obj_train_data";

  const dataFiles = backupEntries.filter((f) => {
    const norm = normalizePath(f.name);
    const folder = getFolder(norm);
    return folder === dataFolder && isImageFile(norm);
  });

  const objTrainFiles = nonBackupEntries.filter((f) => {
    const norm = normalizePath(f.name);
    const folder = getFolder(norm);
    return folder === objTrainFolder && isTxtFile(norm);
  });

  const normalized = normalizeNumericFilenames(
    dataFiles.map((f) => stripFolder(f.name, dataFolder)),
    objTrainFiles.map((f) => stripFolder(f.name, objTrainFolder)),
  );
  if (normalized.issues.length > 0) {
    return { issues: normalized.issues, session: null };
  }
  const dataNames = normalized.imageNames;
  const objTrainNames = normalized.annotationNames;
  // Keep ZIP entries and their bytes untouched; use the resolved names for
  // validation and every persisted file in the resulting session.
  const imageNames = new Map(dataFiles.map((file, index) => [file, dataNames[index]]));
  const annotationNames = new Map(objTrainFiles.map((file, index) => [file, objTrainNames[index]]));
  const imageName = (file: JSZip.JSZipObject) => imageNames.get(file)!;
  const annotationName = (file: JSZip.JSZipObject) => annotationNames.get(file)!;

  const objNamesEntry = nonBackupEntries.find((f) => {
    const norm = normalizePath(f.name);
    return norm === "obj.names";
  });

  if (dataFiles.length === 0) {
    issues.push({
      type: "zip-structure",
      filename: backupName,
      reason: `No image files found in the 'data' subfolder.`,
    });
  }

  if (objTrainFiles.length === 0) {
    issues.push({
      type: "zip-structure",
      filename: nonBackupName,
      reason: `No .txt annotation files found in the 'obj_train_data' subfolder.`,
    });
  }

  if (!objNamesEntry) {
    issues.push({
      type: "missing-obj-names",
      filename: nonBackupName,
      reason: "The 'obj.names' file is missing from this zip.",
    });
  }

  const seenData = new Set<string>();
  for (const name of dataNames) {
    if (seenData.has(name)) {
      issues.push({
        type: "duplicate-filename",
        filename: name,
        reason: "Duplicate image filename in the 'data' folder.",
      });
    }
    seenData.add(name);
  }

  const seenObj = new Set<string>();
  for (const name of objTrainNames) {
    if (seenObj.has(name)) {
      issues.push({
        type: "duplicate-filename",
        filename: name,
        reason: "Duplicate annotation filename in the 'obj_train_data' folder.",
      });
    }
    seenObj.add(name);
  }

  const dataBaseNames = new Set(dataNames.map(getBaseName));
  const objBaseNames = new Set(objTrainNames.map(getBaseName));

  for (const name of dataNames) {
    const base = getBaseName(name);
    if (!objBaseNames.has(base)) {
      issues.push({
        type: "orphaned-image",
        filename: name,
        reason: "No matching .txt annotation file found for this image.",
      });
    }
  }

  for (const name of objTrainNames) {
    const base = getBaseName(name);
    if (!dataBaseNames.has(base)) {
      issues.push({
        type: "orphaned-annotation",
        filename: name,
        reason: "No matching image file found for this annotation.",
      });
    }
  }

  const matchedPairs: { dataFile: JSZip.JSZipObject; objFile: JSZip.JSZipObject }[] = [];
  const objByName = new Map<string, JSZip.JSZipObject>();
  for (const f of objTrainFiles) {
    objByName.set(getBaseName(annotationName(f)), f);
  }
  for (const f of dataFiles) {
    const base = getBaseName(imageName(f));
    const match = objByName.get(base);
    if (match) {
      matchedPairs.push({ dataFile: f, objFile: match });
    }
  }

  const images: ImageFile[] = [];
  for (const pair of matchedPairs) {
    try {
      const blob = await pair.dataFile.async("blob");
      let dims: { width: number; height: number };
      try {
        dims = await getImageDimensions(blob);
      } catch {
        issues.push({
          type: "resolution",
          filename: imageName(pair.dataFile),
          reason: "Could not read image dimensions (file may be corrupted).",
        });
        continue;
      }

      const imgName = imageName(pair.dataFile);
      if (dims.width !== EXPECTED_WIDTH || dims.height !== EXPECTED_HEIGHT) {
        issues.push({
          type: "resolution",
          filename: imgName,
          reason: `Resolution is ${dims.width}x${dims.height}, expected ${EXPECTED_WIDTH}x${EXPECTED_HEIGHT}.`,
          detail: `${dims.width}x${dims.height}`,
        });
      } else {
        images.push({
          name: imgName,
          blob,
          width: dims.width,
          height: dims.height,
        });
      }
    } catch {
      issues.push({
        type: "resolution",
        filename: imageName(pair.dataFile),
        reason: "Failed to extract image data from zip.",
      });
    }
  }

  const annotations: AnnotationFile[] = [];
  for (const pair of matchedPairs) {
    try {
      const text = await pair.objFile.async("string");
      const annName = annotationName(pair.objFile);
      annotations.push({ name: annName, text });
    } catch {
      issues.push({
        type: "zip-structure",
        filename: annotationName(pair.objFile),
        reason: "Failed to extract annotation text from zip.",
      });
    }
  }

  let objNames: ObjNamesFile | null = null;
  if (objNamesEntry) {
    try {
      const text = await objNamesEntry.async("string");
      objNames = { name: "obj.names", text };
    } catch {
      issues.push({
        type: "missing-obj-names",
        filename: nonBackupName,
        reason: "Found obj.names but could not read it.",
      });
    }
  }

  const classCount = objNames?.text.trim() ? objNames.text.trim().split(/\r?\n/).length : 0;
  if (objNames && classCount === 0) {
    issues.push({ type: "invalid-annotation", filename: "obj.names", reason: "obj.names must define at least one class." });
  }
  if (objNames) for (const annotation of annotations) {
    for (const issue of validateYoloText(annotation.text, classCount)) {
      issues.push({
        type: "invalid-annotation",
        filename: annotation.name,
        reason: `Line ${issue.lineNumber}: ${issue.reason}`,
      });
    }
  }

  const pairs: ValidatedPair[] = [];
  const imgByBase = new Map(images.map((img) => [getBaseName(img.name), img]));
  for (const ann of annotations) {
    const base = getBaseName(ann.name);
    const img = imgByBase.get(base);
    if (img && img.width === EXPECTED_WIDTH && img.height === EXPECTED_HEIGHT) {
      pairs.push({ image: img, annotation: ann });
    }
  }

  const blockingIssues = issues.filter(
    (i) =>
      i.type === "filename-mismatch" ||
      i.type === "zip-structure" ||
      i.type === "missing-obj-names" ||
      i.type === "orphaned-image" ||
      i.type === "orphaned-annotation" ||
      i.type === "duplicate-filename" ||
      i.type === "invalid-annotation",
  );

  const resolutionFailures = issues.filter((i) => i.type === "resolution");

  const session: ValidatedSession | null =
    blockingIssues.length === 0 && resolutionFailures.length === 0 && pairs.length > 0
      ? {
          zipBaseName: baseName,
          objNames,
          pairs,
          totalImages: pairs.length,
          totalAnnotations: pairs.length,
          validatedAt: Date.now(),
        }
      : null;

  return { issues, session };
}

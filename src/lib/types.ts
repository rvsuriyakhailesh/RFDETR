export type ValidationIssueType =
  | "filename-mismatch"
  | "orphaned-image"
  | "orphaned-annotation"
  | "resolution"
  | "missing-obj-names"
  | "duplicate-filename"
  | "invalid-annotation"
  | "zip-structure";

export interface ValidationIssue {
  type: ValidationIssueType;
  filename: string;
  reason: string;
  detail?: string;
}

export interface ImageFile {
  name: string;
  blob: Blob;
  width: number;
  height: number;
}

export interface AnnotationFile {
  name: string;
  text: string;
}

export interface ObjNamesFile {
  name: string;
  text: string;
}

export interface ValidatedPair {
  image: ImageFile;
  annotation: AnnotationFile;
}

export interface ValidatedSession {
  zipBaseName: string;
  objNames: ObjNamesFile | null;
  pairs: ValidatedPair[];
  totalImages: number;
  totalAnnotations: number;
  validatedAt: number;
}

export interface SplitFile {
  name: string;
  blob: Blob;
}

export interface SplitData {
  sliverMinSide?: number;
  sliverAspectRatio?: number;
  /** Missing on legacy sessions: filtering was disabled. */
  smallBoxThreshold?: number;
  minRetainedPercentage?: number;
  splitIndex: number;
  trainImages: SplitFile[];
  trainLabels: SplitFile[];
  validImages: SplitFile[];
  validLabels: SplitFile[];
  splitAt: number;
}

export interface TiledFile {
  name: string;
  blob: Blob;
}

export interface TiledData {
  sliverMinSide?: number;
  sliverAspectRatio?: number;
  sliverBoxesRemoved?: { train: number; valid: number };
  smallBoxThreshold?: number;
  minRetainedPercentage?: number;
  clippedFragmentsRemoved?: { train: number; valid: number };
  smallBoxesRemoved?: { train: number; valid: number };
  trainImages: TiledFile[];
  trainLabels: TiledFile[];
  validImages: TiledFile[];
  validLabels: TiledFile[];
  tiledAt: number;
}

export type AppStage =
  | "upload"
  | "validating"
  | "validation-results"
  | "validated"
  | "split-picker"
  | "split-done"
  | "tiling"
  | "tiled"
  | "tile-viewer"
  | "finalization-summary"
  | "finalizing"
  | "finalized";

export interface FinalizationState {
  finalizedAt: number;
  oldFoldersDeleted: boolean;
  zipVersion: number;
}

export interface SessionMeta {
  id: string;
  stage: AppStage;
  updatedAt: number;
}

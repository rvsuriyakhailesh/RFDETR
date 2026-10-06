import type { AppStage, ValidatedSession } from "./types";

/** Processed images are already editor-ready, even if old metadata has a raw stage. */
export function resolveResumeStage(
  session: ValidatedSession, stage: AppStage, zipStale: boolean,
): AppStage {
  if (stage === "finalized") return zipStale ? "finalization-summary" : "finalized";
  if (stage === "finalizing") return "finalization-summary";
  if (session.datasetType === "processed-rfdetr") {
    return stage === "finalization-summary" ? stage : "tile-viewer";
  }
  return stage === "tiling" ? "split-picker" : stage;
}

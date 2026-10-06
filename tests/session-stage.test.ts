import { describe, expect, it } from "vitest";
import { resolveResumeStage } from "../src/lib/session-stage";
import type { AppStage, ValidatedSession } from "../src/lib/types";

const session: ValidatedSession = {
  datasetType: "processed-rfdetr", zipBaseName: "seats", objNames: null,
  pairs: [], totalImages: 194, totalAnnotations: 194, validatedAt: 1,
};

describe("resume routing", () => {
  it.each<AppStage>(["validated", "split-picker", "split-done", "tiling", "tiled", "tile-viewer"])(
    "returns processed %s sessions directly to the editor", stage => {
      expect(resolveResumeStage(session, stage, false)).toBe("tile-viewer");
    },
  );
  it("preserves raw workflow recovery and finalization recovery", () => {
    const raw = { ...session, datasetType: "raw" as const };
    expect(resolveResumeStage(raw, "tiling", false)).toBe("split-picker");
    expect(resolveResumeStage(raw, "validated", false)).toBe("validated");
    expect(resolveResumeStage(raw, "tiled", false)).toBe("tiled");
    for (const input of [raw, session]) {
      expect(resolveResumeStage(input, "finalizing", false)).toBe("finalization-summary");
      expect(resolveResumeStage(input, "finalized", true)).toBe("finalization-summary");
      expect(resolveResumeStage(input, "finalized", false)).toBe("finalized");
    }
  });
});

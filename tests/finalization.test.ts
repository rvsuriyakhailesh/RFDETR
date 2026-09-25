import { describe, it, expect } from "vitest";
import JSZip from "jszip";
import { buildFinalZip, computeFinalSummaryAsync } from "../src/lib/finalization";
import type { TiledData, TiledFile } from "../src/lib/types";

function makeTiledFile(name: string, text: string): TiledFile {
  return { name, blob: new Blob([text], { type: "text/plain" }) };
}

describe("buildFinalZip structure", () => {
  it("produces exactly one root folder named RFDETR_<name> with no extra nesting", async () => {
    const tiled: TiledData = {
      trainImages: [{ name: "img1_1.jpg", blob: new Blob(["img1_1"], { type: "image/jpeg" }) }],
      trainLabels: [makeTiledFile("img1_1.txt", "0 0.5 0.5 0.1 0.1")],
      validImages: [{ name: "img2_1.jpg", blob: new Blob(["img2_1"], { type: "image/jpeg" }) }],
      validLabels: [makeTiledFile("img2_1.txt", "1 0.3 0.3 0.2 0.2")],
      tiledAt: Date.now(),
    };

    const blob = await buildFinalZip(tiled, "class0\nclass1\n", "abc_xyz");
    const zip = await JSZip.loadAsync(blob);

    const topFolders = Object.keys(zip.files).filter((k) => k.endsWith("/"));

    // Top-level should be exactly RFDETR_abc_xyz/
    const topDirs = topFolders.filter((k) => k.split("/").filter(Boolean).length === 1);
    expect(topDirs).toEqual(["RFDETR_abc_xyz/"]);

    // No bare abc_xyz/ folder at top level
    expect(topDirs.some((k) => k === "abc_xyz/")).toBe(false);

    // Check obj.names is prefixed
    const objNamesKey = "RFDETR_abc_xyz/RFDETR_abc_xyz_obj.names";
    expect(zip.files[objNamesKey]).toBeDefined();

    // Check train/images has prefixed tile
    const trainImgKey = "RFDETR_abc_xyz/train/images/abc_xyz_img1_1.jpg";
    expect(zip.files[trainImgKey]).toBeDefined();

    // Check valid/labels has prefixed tile
    const validLabelKey = "RFDETR_abc_xyz/valid/labels/abc_xyz_img2_1.txt";
    expect(zip.files[validLabelKey]).toBeDefined();

    // Ensure no intermediate "abc_xyz" folder appears anywhere
    const allPaths = Object.keys(zip.files);
    const bareFolderPaths = allPaths.filter((p) => p.startsWith("abc_xyz/"));
    expect(bareFolderPaths.length).toBe(0);
  });
});

describe("finalization validation", () => {
  it("identifies an invalid persisted annotation before export", async () => {
    const tiled: TiledData = {
      trainImages: [],
      trainLabels: [makeTiledFile("001_1.txt", "3 0.5 0.5 0.2 0.2")],
      validImages: [],
      validLabels: [],
      tiledAt: Date.now(),
    };
    await expect(computeFinalSummaryAsync(tiled, ["person"])).rejects.toThrow(/001_1\.txt, line 1: Class ID 3/);
  });
});

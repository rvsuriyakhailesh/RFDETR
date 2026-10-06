import type { ProcessedDatasetDraft, ValidationIssue } from "./types";
import { clipYoloBoxToImageBounds, formatYoloLine, parseYoloLine, validateYoloText } from "./tiling";
import { validateProcessedDatasetDraft } from "./processed-dataset";

/** Transform original line indices once per file; unrelated bytes and blobs stay intact. */
export async function repairProcessedBoundaryBoxes(draft: ProcessedDatasetDraft, targets: readonly ValidationIssue[]) {
  if (!targets.length || targets.some(issue => issue.code !== "box-out-of-bounds"
    || !issue.split || !Number.isInteger(issue.lineNumber) || issue.lineNumber! < 1)) {
    throw new Error("Only identified boundary annotation issues can be repaired.");
  }
  const root = `RFDETR_${draft.session.zipBaseName}`;
  const classCount = draft.session.objNames!.text.trim().split(/\r?\n/).length;
  const remaining = new Set(targets);
  const grouped = new Map<string, ValidationIssue[]>();
  for (const issue of targets) {
    const key = `${issue.split}:${issue.filename}`;
    const group = grouped.get(key) ?? [];
    group.push(issue);
    grouped.set(key, group);
  }
  const tiled = { ...draft.tiled };
  for (const split of ["train", "valid"] as const) {
    const key = split === "train" ? "trainLabels" : "validLabels";
    const replacements = [];
    for (const label of tiled[key]) {
      const selected = grouped.get(`${split}:${root}/${split}/labels/${label.name}`) ?? [];
      if (!selected.length) { replacements.push(label); continue; }
      const indices = new Set(selected.map(issue => issue.lineNumber! - 1));
      const text = await label.blob.text();
      const lines = text.match(/[^\n]*\n|[^\n]+$/g) ?? [];
      if ([...indices].some(index => index >= lines.length)) throw new Error("Annotation line has changed. Revalidate before repairing.");
      const repaired = lines.map((raw, index) => {
        if (!indices.has(index)) return raw;
        const problems = validateYoloText(raw, classCount);
        if (problems.length !== 1 || problems[0].code !== "box-out-of-bounds") {
          throw new Error("Annotation line is not a repairable boundary box.");
        }
        const box = clipYoloBoxToImageBounds(parseYoloLine(raw)!);
        if (!box) return "";
        let corrected = formatYoloLine(box);
        // Six-decimal rounding must not erase a tiny but visible box.
        if (validateYoloText(corrected, classCount).length) {
          corrected = [box.cls, box.xCenter, box.yCenter, box.width, box.height].join(" ");
        }
        return corrected + (raw.endsWith("\r\n") ? "\r\n" : raw.endsWith("\n") ? "\n" : "");
      }).join("");
      replacements.push({ ...label, blob: new Blob([repaired], { type: "text/plain" }) });
      selected.forEach(issue => remaining.delete(issue));
    }
    tiled[key] = replacements;
  }
  if (remaining.size) throw new Error("Annotation file was not found. No repairs were applied.");
  return validateProcessedDatasetDraft({ ...draft, tiled });
}

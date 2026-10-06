# Reopening downloaded RFDETR datasets

Implemented and verified on 6 October 2026. Inspection found that this repository
already contained the core processed-import and editor-split implementation.
This change completes and hardens that implementation without replacing the raw
pipeline, editor, persistence schema, or export format.

## 1. Files changed

- `src/App.tsx`: clear stale saved state after failed processed validation; use explicit resume routing.
- `src/lib/session-stage.ts` (new): shared raw/processed resume-stage resolution.
- `src/lib/processed-dataset.ts`: validate ZIP directory counts, sizes and multipart metadata; report unreadable class names.
- `src/lib/editor.ts`: serialize processed coordinates without six-decimal rounding; retain raw formatting.
- `src/components/TileViewer.tsx`: use precision-preserving saves, native split confirmation, and separate image URL lifetime from annotation loading.
- `tests/session-stage.test.ts` (new): processed resume and raw/finalization recovery tests.
- `tests/editor.test.ts`: processed coordinate precision and unchanged raw formatting tests.
- `tests/processed-dataset.test.ts`: malformed archive, noncontiguous membership and edited-coordinate round trips.
- `scripts/browser-check.mjs`: real-browser precision, dialog, resume-stage and failed-import checks; native Tab/Escape key simulation.
- This report.

## 2. Processed ZIP detection

`detectDatasetType(files)` inspects archive paths, independently of the uploaded
ZIP filename. It recognizes the exact existing `buildFinalZip` layout:

```text
RFDETR_<name>/
  RFDETR_<name>_obj.names
  train/images/
  train/labels/
  valid/images/
  valid/labels/
```

The root, matching class names file, and four dataset folders are required.
Partial processed signatures are invalid rather than falling back to raw
validation. Missing folders, malformed YOLO lines, conflicting basenames,
missing pairs, unreadable images, unexpected files and unsafe/duplicate archive
paths produce validation errors. The importer now also checks central-directory
entry counts and sizes before JSZip can overwrite conflicting entries.

## 3. Loading Train/Valid files

`loadProcessedDataset` loads each image and its exact matching label into the
existing `TiledData` arrays for its original partition. Original image bytes,
label bytes and filenames are retained. Image readability is checked once during
import; editor image URLs are created for the current image only. Arbitrary
readable dimensions are accepted; raw resolution rules do not apply.

## 4–5. Bypassing split and tiling; editor routing

Successful single-ZIP imports persist `datasetType: "processed-rfdetr"` and
editor-ready data with stage `tile-viewer`. They open the existing full Annotation
Editor directly, with no raw validation normalization, SplitPicker, tiling or
filtering. Raw two-ZIP uploads retain their original validation/split/tiling path.
Resume explicitly routes processed data to the editor even if old stage metadata
incorrectly names a raw processing stage.

## 6–7. Mark as Last Train Image and assignment updates

The processed editor displays current membership, Train/Valid counts and the
last Train filename. Its split control opens a confirmation showing proposed
counts. The native modal traps focus, supports Escape cancellation, and prevents
interaction with the underlying editor.

`orderedDatasetItems` supplies the same natural/numeric order for processed
navigation and split updates. `updateDatasetSplit` assigns indices through the
current index to Train, and later indices to Valid. It reuses image and label
references together. It does not crop, retile, filter, rename or change boxes.
Existing noncontiguous assignments remain unchanged until a boundary is selected.
At least one Train image remains; an empty Valid partition is allowed, consistent
with the existing split rules.

## 8. Persistence and unsaved annotations

The existing Dexie/IndexedDB session record and `saveTiled` persist both membership
and edits; no schema migration is needed. Dirty current-image annotations and the
new split commit in one record write. Failed writes preserve both the previous
saved split and the editor's unsaved edits; cancellation preserves edits too.
Failed processed validation now clears an older saved project, matching raw
validation behavior, so reload cannot unexpectedly resume that older dataset.

## 9. Final ZIP behavior

The existing generator uses current `TiledData` partition arrays for both images
and labels. `preserveFilenames` avoids applying the raw export prefix again.
Split updates and saved annotations invalidate the cached final ZIP in memory
and IndexedDB. The next export therefore uses the current assignments and edits.
No ZIP format change was necessary.

Processed editor serialization now retains JavaScript numeric precision rather
than rounding every box to six decimals when any box is edited. Unedited label
files remain byte-for-byte unchanged; untouched coordinates in edited files retain
their numeric values. The raw editor keeps its original six-decimal formatting.

## 10. Round-trip results

- Automated 194-image round trips verified 150/44 → 160/34 → 120/74 membership.
- Exported Train images/labels and Valid images/labels have exact matching counts.
- Three repeated import/export cycles preserve names, image bytes, label bytes,
  classes and coordinates for unchanged items.
- Edited-box round trips retain untouched high-precision coordinates across
  three ZIP cycles; serialization tests additionally cover five repeated saves.
- Real Chromium checks exercise actual raw export re-upload, direct editor entry,
  dirty split save/cancel/failure/retry, reload/resume, changed-split cache
  invalidation, exact final ZIP counts and subsequent re-upload.

## 11. Raw regression results

Unit tests cover filename normalization, YOLO validation, resolution cleanup,
tiling, area thresholds, retained-percentage and sliver filtering. Browser checks
cover raw uploads, individual/bulk resolution cleanup, split/tiling/editor entry,
box editing and shortcuts, failed Save/retry, resume, final export, cached-ZIP
invalidation and intermediate cleanup. Processed checks exercise selection,
move/resize, one-pixel nudging, draw, line-select/delete, copy/paste, visibility,
Undo, Save, zoom, pan, fullscreen and Previous/Next in the same editor.

## 12. Project checks

- `npm test`: 186 tests passed in 16 files.
- `npm run typecheck`: passed.
- `npm run lint`: passed with zero errors; one pre-existing Fast Refresh warning
  in `SplitPicker.tsx`.
- `npm run build`: passed; existing Browserslist data is outdated.
- `node scripts/browser-check.mjs`: passed in headless Chromium.
- `git diff --check`: passed.

Vite/esbuild initially could not spawn child processes in the restricted sandbox.
Tests, build and browser checks ran successfully with approved process execution.

## 13. Remaining known limitations

No failing feature checks remain. The importer supports the application's exact
download format, with one root and unique image basenames across partitions.
ZIP64 and multipart archives are unsupported; they produce validation errors.
The existing lint and Browserslist warnings remain unrelated to this change.

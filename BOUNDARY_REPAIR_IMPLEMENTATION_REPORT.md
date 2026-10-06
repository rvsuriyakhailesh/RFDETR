# Processed RFDETR boundary repair

Implemented and verified on 6 October 2026, extending the existing processed
import, validation UI, Dexie persistence and editor workflow.

## 1. Files changed for this request

- `src/lib/types.ts`: structured validation codes and processed validation draft.
- `src/lib/tiling.ts`: typed YOLO diagnostics and reusable edge-clipping helper.
- `src/lib/processed-dataset.ts`: retain safe drafts and revalidate current labels.
- `src/lib/annotation-repair.ts` (new): exact-line individual and grouped bulk repair.
- `src/lib/db.ts`: persist validation drafts in the existing session record.
- `src/App.tsx`: commit repairs, restore drafts, and route clean processed data directly to the editor.
- `src/components/ValidationResults.tsx`: Fix Box, dynamic Fix All and busy state.
- `tests/annotation-repair.test.tsx` (new): 21 clipping, validation, repair, UI and round-trip tests.
- `scripts/browser-check.mjs`: real-browser repair, failure/retry, persistence and export checks.
- This report. Earlier reopen-workflow changes remain in the working tree.

## 2. Structured codes

YOLO validation now returns `box-out-of-bounds`, `invalid-class`, `malformed-yolo`
or `invalid-dimensions`, alongside the existing readable reasons. Processed
annotation issues also carry the original one-based `lineNumber`, `split`, and
full annotation path. Repair eligibility uses codes, never English message matching.
Existing raw validation rules and boundary tolerance are unchanged.

## 3. Loader changes

Structurally sound processed archives with annotation errors retain a
`ProcessedDatasetDraft`. Invalid datasets still return null editor `session` and
`tiled` values. Broken folders, duplicate/conflicting names, missing pairs and
failed image/label extraction remain blocking and do not retain a repair draft.

Drafts may include mixed annotation errors so boundary boxes can be repaired
while an invalid class or malformed line remains blocked. Draft metadata is not
a validated editor session; editor access requires zero remaining issues.

## 4. Clipping helper

`clipYoloBoxToImageBounds` converts center/size to edges, intersects those edges
with the normalized image rectangle, and reconstructs center/size. It preserves
the class ID and returns null only when no visible area remains. Invalid class
or dimension input is rejected. A fully inside box is returned unchanged.

Corrected lines normally use the app's six-decimal format. If that would round a
tiny visible box to zero dimensions, sufficient numeric precision is retained.
The original validator's rounding tolerance continues to apply.

## 5. Fix Box

Each eligible issue has a Fix Box control. Its target is the exact partition,
annotation path and original line number. The line is checked again for the
structured boundary code before repair. Unrelated lines, whitespace, line
endings, ordering, class IDs and label blobs are preserved. An invisible box
removes only its target line.

## 6. Fix All

The bulk action displays the current boundary issue count. Targets are grouped
by annotation file. Each affected file is read and transformed once, using a map
over original line indices, then written once. Removing line 107 therefore
cannot change the targeting of original lines 108 and 109. New validation after
each action supplies fresh line numbers and counts.

## 7. Source of truth

The draft's `TiledData` label blobs are replaced with repaired content; warnings
are not merely hidden. Unchanged image arrays and image/label blobs retain their
references. On successful validation, those same current arrays become the
normal editor dataset. The uploaded ZIP is not retained as an alternate source
for export. No filename normalization, tiling, image cropping or filtering runs.

## 8. Revalidation and routing

All current Train/Valid labels are revalidated after repair. Remaining malformed
lines, classes and dimensions stay visible and block the editor. When no issues
remain, the existing Annotation Editor opens directly, bypassing SplitPicker
and tiling. Raw uploads do not receive the processed repair controls.

## 9. Persistence

`saveProcessedDraft` adds an optional, unindexed draft field to the existing
Dexie session record; no schema migration is needed. Partial repairs persist,
and reload restores validation with freshly computed issues. Completed repairs
persist as the normal editor session and use existing Resume behavior. Once
valid, the stored draft is removed.

Repair results are committed before replacing UI state. A failed write leaves
the previous saved data and displayed issues intact, allowing retry. Busy state
and a synchronous operation guard prevent concurrent repair actions.

## 10. Final ZIP

Draft and validated-session commits clear finalization/cache state. The existing
ZIP builder reads corrected current label blobs, preserving the output format,
filenames and partition assignments. Browser tests verified repaired text in the
exported archive and compared every exported image's bytes with the import.
Re-upload of that export opens the editor without boundary validation errors.

## 11. Tests added and regressions

The 21 new tests cover inside boxes, all four edges and four corners, invisible
boxes, class preservation, positive dimensions, tiny overflow and invalid input.
They also cover six issues to five to zero, exact unrelated-byte preservation,
original lines 107–109 with removals, mixed blocking errors, stale targets,
tiny visible fragments, processed-only UI controls and repaired ZIP round trips.

Real Chromium checks additionally cover storage failure/retry, partial-draft
reload, completed-repair Resume, exact fixed values in export and re-upload,
unchanged image bytes, and five boundary errors plus one invalid class.

The full browser regression suite also passed for raw upload, resolution-error
deletion, split/tiling, editor shortcuts, processed split changes, image deletion,
Save/Resume and final ZIP generation.

## 12. Check results

- `npm test`: 207 tests passed across 17 files.
- `npm run typecheck`: passed.
- `npm run lint`: passed with zero errors and the pre-existing SplitPicker Fast Refresh warning.
- `npm run build`: passed with the existing outdated Browserslist warning.
- `node scripts/browser-check.mjs`: passed with no browser runtime exceptions.
- `git diff --check`: passed.

## 13. Remaining known issues

No failing repair checks remain. Automatic repair is limited to structurally
sound processed datasets and lines with the boundary code. Other validation
problems still require corrected source data/re-upload. Existing ZIP64/multipart
limitations and the unrelated lint/Browserslist warnings remain.

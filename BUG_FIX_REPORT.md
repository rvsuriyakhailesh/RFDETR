# RFDETR bug-fix and regression check

Completed: 2026-09-30.

The validation-to-export pipeline and annotation editor were reviewed. The
findings below were fixed and checked with unit/integration tests and an
isolated headless Chrome session using actual image decoding, canvas tiling,
IndexedDB, mouse events, keyboard events, and ZIP generation.

## Findings fixed

| Finding | Fix | Verification |
| --- | --- | --- |
| Ctrl+D could be ignored after using the image-number field because selection prevented the normal focus change. | Make the canvas focusable and explicitly focus it when selecting/drawing. | Browser: focus input, click box, Ctrl+D deletes, Ctrl+Z restores. |
| Arrow keys navigated instead of moving selected annotations. | Selected boxes move one source-image pixel per arrow press, with boundary clamping and Undo; left/right still navigate when nothing is selected. | Browser verifies horizontal movement; existing movement tests cover group movement and boundaries. |
| Undo and other shortcuts could act while a drawing or class selection was pending. | Block editing shortcuts during active drawing/line selection except Escape; guard Undo during drawing, saving, resizing and dialogs. | Browser exercises drawing, class assignment, modal protection and Undo. |
| Nonnumeric image names with the same basename but different extensions could overwrite pairing entries. | Reject duplicate basenames for both images and annotations before permitting continuation. Numeric normalization remains unchanged. | New validation tests cover image-extension and annotation-extension-case collisions. |
| Same-named train/valid tiles could read the other split's annotation in resumed data. | Build a separate annotation lookup for each split and use split-qualified React keys. | Browser loads different annotation counts for identically named train/valid tiles. |
| Conditional export prefixing could collapse two different filenames into one ZIP entry. | Prefix every source filename consistently and reject duplicate destination entries. ZIP version increased to 4 so old cached exports are rebuilt. | Tests verify both prefixed and unprefixed source names survive export with their original contents. |
| Navigation during final ZIP creation/persistence could leave stale UI/output state. | Disable back-navigation and intermediate cleanup while exporting; guard duplicate build actions. | Browser holds the final save pending and verifies navigation is disabled. |
| Starting another split/tiling run retained prior derived state in memory. | Clear prior tiles, finalization and ZIP state when the new split is committed, matching database invalidation. | Code review plus browser cache-invalidation/export checks. |
| Sliver-default regression test expected obsolete settings. | Update expectations to the deliberately committed defaults: minimum side 40, aspect ratio 3. | Full sliver suite passes; application defaults were not changed. |

## Resolution cleanup verification

- Individual deletion removes the exact image/annotation pair; missing annotations do not crash.
- Bulk deletion requires confirmation; Cancel leaves files untouched.
- Counts update from 9 resolution errors to 8 to 0, and dataset image/annotation counts update together.
- Valid files and unrelated validation issues remain; numeric names are not renormalized after deletion.
- A shared annotation cannot be deleted while a remaining image depends on it.
- Injecting a database write failure leaves the original dataset and displayed counts intact.
- Splits, tiled output, annotations and the final ZIP exclude deleted sources.
- Saving an annotation invalidates the cached ZIP; failed saves preserve unsaved edits and permit retry.
- Reload/Resume restores saved edits. Intermediate cleanup preserves tiled data and the final ZIP.

## Check results

| Check | Result |
| --- | --- |
| `npm test` | 152 passed across 13 test files; no failures. |
| `node scripts/browser-check.mjs` | Passed the upload, cleanup, editor, persistence, export and split-pairing scenarios above; no browser runtime exceptions. |
| `npm run typecheck` | Passed. |
| `npm run build` | Passed; production output updated in `dist/`. |
| `npm run lint` | Zero errors; one existing Fast Refresh warning in `SplitPicker.tsx`. |
| `git diff --check` | Passed. |

The browser script uses an isolated temporary profile and generated fixtures;
it does not modify an existing browser profile or the user's uploaded files.
Run it with Node 24 and an installed Chromium browser; `CHROME_PATH` can override
the detected browser. Port 5189 must be free. A successful run saves a screenshot
to `.browser-check.local/result.png` (ignored by Git).

## Files changed during this review

- `src/App.tsx`: invalidate derived in-memory state when starting tiling.
- `src/components/TileViewer.tsx`: focus, shortcuts, modal protection and split-specific annotation pairing.
- `src/components/FinalizationSummary.tsx`: lock conflicting actions during export.
- `src/lib/validation.ts`: detect duplicate basenames.
- `src/lib/finalization.ts`: prevent filename collisions and invalidate old ZIP caches.
- `tests/validation-normalization.test.ts`: basename-collision regressions.
- `tests/finalization.test.ts`: ZIP filename/data-loss regressions.
- `tests/sliver-filter.test.ts`: align stale expectations with existing defaults.
- `scripts/browser-check.mjs`: reproducible browser regression checks.
- `BUG_FIX_REPORT.md`: this report.

The earlier resolution-cleanup changes and their tests were retained and included
in the checks.

## Remaining limits

No failures remain in the checks performed. This is not a guarantee against all
bugs: browser interaction was tested in desktop Chrome, not Firefox, Safari or
touch devices, and no large-dataset stress test was run. The build also reports
outdated Browserslist metadata; dependencies were not changed during this review.

Export filenames that already start with the dataset prefix now receive the
prefix again. This preserves both files in collisions such as `one_1.jpg` and
`seats_one_1.jpg`; in-memory source names and numeric normalization are unchanged.

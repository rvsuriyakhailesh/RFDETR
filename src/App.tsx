import { useCallback, useEffect, useState } from "react";
import { Layers, ArrowRight, CheckCircle2, Loader2, RotateCcw } from "lucide-react";
import { Uploader } from "@/components/Uploader";
import { ValidationResults } from "@/components/ValidationResults";
import { ResumePrompt } from "@/components/ResumePrompt";
import { SplitPicker, computeSplitData } from "@/components/SplitPicker";
import { TileViewer } from "@/components/TileViewer";
import { FinalizationSummary, FinalizedDownload } from "@/components/FinalizationSummary";
import { validateZipFiles } from "@/lib/validation";
import { ZIP_VERSION } from "@/lib/finalization";
import { runTiling, type TilingProgress } from "@/lib/tiling-pipeline";
import { DEFAULT_SMALL_BOX_THRESHOLD, DEFAULT_MIN_RETAINED_PERCENTAGE, sanitizeSmallBoxThreshold, sanitizeMinRetainedPercentage } from "@/lib/tiling-settings";
import { DEFAULT_SLIVER_MIN_SIDE, DEFAULT_SLIVER_ASPECT_RATIO, sanitizeSliverValue } from "@/lib/tiling-settings";
import {
  loadSession,
  saveSession,
  saveSplit,
  saveTiled,
  saveFinalization,
  cleanupIntermediateData,
  updateSessionStage,
  clearSession,
  requestPersistentStorage,
} from "@/lib/db";
import type {
  ValidationIssue,
  ValidatedSession,
  AppStage,
  SplitData,
  TiledData,
  TiledFile,
  FinalizationState,
} from "@/lib/types";

type AppState =
  | { mode: "checking" }
  | {
      mode: "resume-prompt";
      updatedAt: number;
      pairCount: number;
      hasSplit: boolean;
    }
  | {
      mode: "main";
      stage: AppStage;
      issues: ValidationIssue[];
      session: ValidatedSession | null;
      split: SplitData | null;
      tiled: TiledData | null;
      tilingProgress: TilingProgress | null;
      finalization: FinalizationState | null;
      finalZip: Blob | null;
    }
  | { mode: "error"; message: string };

export default function App() {
  const [state, setState] = useState<AppState>({ mode: "checking" });
  const [isValidating, setIsValidating] = useState(false);
  const [actionError, setActionError] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const record = await loadSession();
        if (cancelled) return;
        if (record && record.session) {
          const stage = record.meta.stage;
          if (stage === "finalized") {
            const fin = record.finalization;
            const zipStale = !fin || fin.zipVersion !== ZIP_VERSION || !record.finalZip;
            if (zipStale) {
              try {
                await updateSessionStage("finalization-summary");
              } catch (error) {
                setActionError(error instanceof Error ? error.message : "Could not update the saved stage.");
              }
            }
            if (cancelled) return;
            setState({
              mode: "main",
              stage: zipStale ? "finalization-summary" : "finalized",
              issues: [],
              session: record.session,
              split: record.split ?? null,
              tiled: record.tiled ?? null,
              tilingProgress: null,
              finalization: fin ?? null,
              finalZip: zipStale ? null : record.finalZip ?? null,
            });
          } else if (stage === "validated" || stage === "split-picker" || stage === "split-done" || stage === "tiling" || stage === "tiled" || stage === "tile-viewer" || stage === "finalization-summary" || stage === "finalizing") {
            setState({
              mode: "resume-prompt",
              updatedAt: record.meta.updatedAt,
              pairCount: record.session.totalImages,
              hasSplit: record.split != null || record.tiled != null,
            });
          } else {
            const fin = record.finalization;
            const zipStale = Boolean(fin && fin.zipVersion !== ZIP_VERSION);
            setState({
              mode: "main",
              stage,
              issues: [],
              session: record.session,
              split: record.split ?? null,
              tiled: record.tiled ?? null,
              tilingProgress: null,
              finalization: fin ?? null,
              finalZip: zipStale ? null : record.finalZip ?? null,
            });
          }
        } else {
          setState({ mode: "main", stage: "upload", issues: [], session: null, split: null, tiled: null, tilingProgress: null, finalization: null, finalZip: null });
        }
      } catch {
        if (!cancelled) {
          setState({ mode: "main", stage: "upload", issues: [], session: null, split: null, tiled: null, tilingProgress: null, finalization: null, finalZip: null });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleValidate = useCallback(async (file1: File, file2: File) => {
    setIsValidating(true);
    try {
      const result = await validateZipFiles(file1, file2);
      if (result.session) {
        await saveSession(
          { id: "current", stage: "validated", updatedAt: Date.now() },
          result.session,
        );
        setState({
          mode: "main",
          stage: "validated",
          issues: [],
          session: result.session,
          split: null,
          tiled: null,
          tilingProgress: null,
          finalization: null,
          finalZip: null,
        });
      } else {
        setState({
          mode: "main",
          stage: "validation-results",
          issues: result.issues,
          session: null,
          split: null,
          tiled: null,
          tilingProgress: null,
          finalization: null,
          finalZip: null,
        });
      }
    } catch (err) {
      setState({
        mode: "error",
        message: err instanceof Error ? err.message : "An unexpected error occurred.",
      });
    } finally {
      setIsValidating(false);
    }
  }, []);

  const handleReset = useCallback(() => {
    setState({ mode: "main", stage: "upload", issues: [], session: null, split: null, tiled: null, tilingProgress: null, finalization: null, finalZip: null });
  }, []);

  const handleResume = useCallback(async () => {
    try {
      const record = await loadSession();
      if (record && record.session) {
        const fin = record.finalization;
        const zipStale = Boolean(fin && fin.zipVersion !== ZIP_VERSION) || (record.meta.stage === "finalized" && !record.finalZip);
        const stage = record.meta.stage === "tiling" ? "split-picker"
          : record.meta.stage === "finalizing" ? "finalization-summary"
            : record.meta.stage === "finalized" && zipStale ? "finalization-summary" : record.meta.stage;
        if (stage !== record.meta.stage) await updateSessionStage(stage);
        setState({
          mode: "main",
          stage,
          issues: [],
          session: record.session,
          split: record.split ?? null,
          tiled: record.tiled ?? null,
          tilingProgress: null,
          finalization: fin ?? null,
          finalZip: zipStale ? null : record.finalZip ?? null,
        });
      } else {
        setState({ mode: "main", stage: "upload", issues: [], session: null, split: null, tiled: null, tilingProgress: null, finalization: null, finalZip: null });
      }
    } catch (error) {
      setState({ mode: "error", message: error instanceof Error ? error.message : "Could not resume the saved session." });
    }
  }, []);

  const handleStartFresh = useCallback(async () => {
    await clearSession();
    setState({ mode: "main", stage: "upload", issues: [], session: null, split: null, tiled: null, tilingProgress: null, finalization: null, finalZip: null });
  }, []);

  const handleGoToSplit = useCallback(() => {
    setState((prev) =>
      prev.mode === "main"
        ? { ...prev, stage: "split-picker" }
        : prev,
    );
  }, []);

  const handleSplitConfirm = useCallback(
    async (splitIndex: number, smallBoxThreshold: number, minRetainedPercentage: number, sliverMinSide: number, sliverAspectRatio: number) => {
      if (state.mode !== "main" || !state.session) return;
      setActionError("");
      try {
        const splitData = computeSplitData(state.session.pairs, splitIndex, smallBoxThreshold, minRetainedPercentage, sliverMinSide, sliverAspectRatio);
        await saveSplit(splitData, {
          id: "current",
          stage: "tiling",
          updatedAt: Date.now(),
        });
        setState((prev) =>
          prev.mode === "main"
            ? { ...prev, stage: "tiling", split: splitData, tilingProgress: { current: 0, total: splitData.trainImages.length + splitData.validImages.length, imageName: "" } }
            : prev,
        );

        const tiledData = await runTiling(
          splitData.trainImages,
          splitData.trainLabels,
          splitData.validImages,
          splitData.validLabels,
          (progress) => {
            setState((prev) =>
              prev.mode === "main"
                ? { ...prev, tilingProgress: progress }
                : prev,
            );
          },
          splitData.smallBoxThreshold,
          splitData.minRetainedPercentage,
          splitData.sliverMinSide,
          splitData.sliverAspectRatio,
        );

        await saveTiled(tiledData, {
          id: "current",
          stage: "tiled",
          updatedAt: Date.now(),
        });
        setState((prev) =>
          prev.mode === "main"
            ? { ...prev, stage: "tiled", tiled: tiledData, tilingProgress: null }
            : prev,
        );
      } catch (error) {
        setActionError(error instanceof Error ? error.message : "Could not tile the dataset.");
        setState((prev) => prev.mode === "main"
          ? { ...prev, stage: "split-picker", tilingProgress: null }
          : prev);
      }
    },
    [state],
  );

  const handleBackFromSplit = useCallback(() => {
    setState((prev) =>
      prev.mode === "main"
        ? { ...prev, stage: "validated" }
        : prev,
    );
  }, []);

  const handleBackFromTiled = useCallback(() => {
    setState((prev) =>
      prev.mode === "main"
        ? { ...prev, stage: "split-picker" }
        : prev,
    );
  }, []);

  const handleGoToTileViewer = useCallback(() => {
    setState((prev) =>
      prev.mode === "main"
      ? { ...prev, stage: "tile-viewer" }
      : prev,
    );
  }, []);

  const handleBackFromTileViewer = useCallback(() => {
    setState((prev) =>
      prev.mode === "main"
      ? { ...prev, stage: "tiled" }
      : prev,
    );
  }, []);

  const handleSaveLabel = useCallback(
    async (split: "train" | "valid", labelName: string, text: string): Promise<void> => {
      if (state.mode !== "main" || !state.tiled) throw new Error("No tiled dataset is open.");
      const newBlob = new Blob([text], { type: "text/plain" });
      const sourceLabels = split === "train" ? state.tiled.trainLabels : state.tiled.validLabels;
      if (!sourceLabels.some((label) => label.name === labelName)) {
        throw new Error(`Annotation ${labelName} was not found.`);
      }
      const updateLabels = (labels: TiledFile[]) =>
        labels.map((label) => label.name === labelName ? { ...label, blob: newBlob } : label);
      const tiled: TiledData = {
        ...state.tiled,
        trainLabels: split === "train" ? updateLabels(state.tiled.trainLabels) : state.tiled.trainLabels,
        validLabels: split === "valid" ? updateLabels(state.tiled.validLabels) : state.tiled.validLabels,
      };
      await saveTiled(tiled, { id: "current", stage: "tile-viewer", updatedAt: Date.now() });
      setState((prev) => prev.mode === "main"
        ? { ...prev, tiled, finalZip: null, finalization: prev.finalization?.oldFoldersDeleted
          ? { ...prev.finalization, finalizedAt: 0 } : null }
        : prev);
    },
    [state],
  );

  const handleGoToFinalization = useCallback(async () => {
    setState((prev) => prev.mode === "main" ? { ...prev, stage: "finalizing" } : prev);
    try {
      const record = await loadSession();
      if (!record?.tiled || !record.session) throw new Error("No saved tiled dataset is available.");
      const cachedZipValid = Boolean(record.finalZip && record.finalization?.zipVersion === ZIP_VERSION);
      const target: AppStage = cachedZipValid ? "finalized" : "finalization-summary";
      await updateSessionStage(target);
      setState((prev) => prev.mode === "main"
        ? { ...prev, stage: target, finalZip: cachedZipValid ? record.finalZip : null, finalization: record.finalization }
        : prev);
      setActionError("");
    } catch (error) {
      setState((prev) => prev.mode === "main" ? { ...prev, stage: "tile-viewer" } : prev);
      setActionError(error instanceof Error ? error.message : "Could not open finalization.");
    }
  }, []);

  const handleBackFromFinalization = useCallback(async () => {
    try {
      await updateSessionStage("tile-viewer");
      setState((prev) => prev.mode === "main" ? { ...prev, stage: "tile-viewer" } : prev);
      setActionError("");
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Could not reopen the editor.");
    }
  }, []);

  const handleFinalize = useCallback(async (zipBlob: Blob): Promise<void> => {
    const finalization: FinalizationState = {
      finalizedAt: Date.now(),
      oldFoldersDeleted: state.mode === "main" ? state.finalization?.oldFoldersDeleted ?? false : false,
      zipVersion: ZIP_VERSION,
    };
    await saveFinalization(finalization, {
      id: "current",
      stage: "finalized",
      updatedAt: Date.now(),
    }, zipBlob);
    setState((prev) =>
      prev.mode === "main"
        ? { ...prev, stage: "finalized", finalZip: zipBlob, finalization }
        : prev,
    );
  }, [state]);

  const handleDeleteOldFolders = useCallback(async (): Promise<void> => {
    if (state.mode !== "main" || !state.tiled) throw new Error("No tiled dataset is open.");
    const finalization: FinalizationState = {
      finalizedAt: state.finalization?.finalizedAt ?? 0,
      oldFoldersDeleted: true,
      zipVersion: state.finalization?.zipVersion ?? ZIP_VERSION,
    };
    const record = await cleanupIntermediateData(finalization);
    setState((prev) => prev.mode === "main"
      ? { ...prev, session: record.session, split: null, finalization }
      : prev);
  }, [state]);

  const handleBackFromFinalized = useCallback(async () => {
    try {
      await updateSessionStage("tile-viewer");
      setState((prev) => prev.mode === "main" ? { ...prev, stage: "tile-viewer" } : prev);
      setActionError("");
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Could not reopen the editor.");
    }
  }, []);

  useEffect(() => {
    requestPersistentStorage().catch(() => {});
  }, []);

  if (state.mode === "checking") {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-sm text-slate-400">Loading...</div>
      </div>
    );
  }

  if (state.mode === "resume-prompt") {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <ResumePrompt
          onResume={handleResume}
          onStartFresh={handleStartFresh}
          updatedAt={state.updatedAt}
          pairCount={state.pairCount}
          hasSplit={state.hasSplit}
        />
      </div>
    );
  }

  if (state.mode === "error") {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="bg-white border border-slate-200 rounded-2xl p-8 max-w-md text-center shadow-sm">
          <p className="text-sm text-red-600 mb-4">{state.message}</p>
          <button
            onClick={handleReset}
            className="px-6 py-3 rounded-xl bg-slate-900 text-white font-semibold text-sm hover:bg-slate-800 transition-colors"
          >
            Try Again
          </button>
        </div>
      </div>
    );
  }

  const { stage, issues, session, split, tiled, tilingProgress, finalization, finalZip } = state;

  const suggestedSplitIndex = session
    ? Math.min(
        session.pairs.length - 1,
        Math.round(session.pairs.length * 0.8) - 1,
      )
    : 0;

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-slate-900 flex items-center justify-center">
            <Layers className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-base font-bold text-slate-800 leading-tight">
              RFDETR Dataset Builder
            </h1>
            <p className="text-xs text-slate-400">
              YOLO-format zip to tiled RFDETR training data
            </p>
          </div>
        </div>
      </header>

      <main className="py-12 px-6">
        {actionError && <div role="alert" className="max-w-2xl mx-auto mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{actionError}</div>}
        {stage === "upload" && (
          <div className="space-y-8">
            <div className="text-center mb-8">
              <h2 className="text-2xl font-bold text-slate-800 mb-2">
                Upload your zip files
              </h2>
              <p className="text-sm text-slate-500 max-w-lg mx-auto">
                Provide two zip files whose names differ only by a{" "}
                <code className="text-xs bg-slate-100 px-1.5 py-0.5 rounded font-mono">
                  _backup
                </code>{" "}
                suffix. The backup zip should contain images in{" "}
                <span className="font-medium">data/</span>; the other should
                contain annotations in{" "}
                <span className="font-medium">obj_train_data/</span> and an{" "}
                <span className="font-medium">obj.names</span> file.
              </p>
            </div>
            <Uploader onValidate={handleValidate} isValidating={isValidating} />
          </div>
        )}

        {stage === "validating" && (
          <div className="flex items-center justify-center py-20">
            <p className="text-sm text-slate-400">Validating...</p>
          </div>
        )}

        {stage === "validation-results" && (
          <ValidationResults
            issues={issues}
            onSuccess={handleReset}
            onReset={handleReset}
          />
        )}

        {stage === "validated" && session && (
          <div className="w-full max-w-2xl mx-auto">
            <div className="bg-white border border-slate-200 rounded-2xl p-8 text-center shadow-sm">
              <div className="w-16 h-16 rounded-full bg-green-50 flex items-center justify-center mx-auto mb-4">
                <CheckCircle2 className="w-8 h-8 text-green-600" />
              </div>
              <h2 className="text-xl font-bold text-slate-800 mb-2">
                Validation complete
              </h2>
              <p className="text-sm text-slate-500 mb-6">
                {session.pairs.length} image-annotation pair
                {session.pairs.length === 1 ? "" : "s"} validated successfully.
                {session.objNames && (
                  <>
                    {" "}
                    Found{" "}
                    {session.objNames.text.trim().split("\n").length} class
                    {session.objNames.text.trim().split("\n").length === 1
                      ? ""
                      : "es"}{" "}
                    in obj.names.
                  </>
                )}
              </p>
              <button
                onClick={handleGoToSplit}
                className="px-6 py-3 rounded-xl bg-slate-900 text-white font-semibold text-sm hover:bg-slate-800 transition-colors inline-flex items-center gap-2"
              >
                Choose Train/Valid Split
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {stage === "split-picker" && session && (
          <SplitPicker
            pairs={session.pairs}
            initialSplitIndex={split?.splitIndex ?? suggestedSplitIndex}
            initialSmallBoxThreshold={split ? sanitizeSmallBoxThreshold(split.smallBoxThreshold) : DEFAULT_SMALL_BOX_THRESHOLD}
            initialMinRetainedPercentage={sanitizeMinRetainedPercentage(split?.minRetainedPercentage ?? DEFAULT_MIN_RETAINED_PERCENTAGE)}
            initialSliverMinSide={sanitizeSliverValue(split?.sliverMinSide ?? DEFAULT_SLIVER_MIN_SIDE)}
            initialSliverAspectRatio={sanitizeSliverValue(split?.sliverAspectRatio ?? DEFAULT_SLIVER_ASPECT_RATIO)}
            onConfirm={handleSplitConfirm}
            onBack={handleBackFromSplit}
          />
        )}

        {stage === "split-done" && split && (
          <div className="w-full max-w-2xl mx-auto">
            <div className="bg-white border border-slate-200 rounded-2xl p-8 text-center shadow-sm">
              <div className="w-16 h-16 rounded-full bg-green-50 flex items-center justify-center mx-auto mb-4">
                <CheckCircle2 className="w-8 h-8 text-green-600" />
              </div>
              <h2 className="text-xl font-bold text-slate-800 mb-2">
                Split confirmed
              </h2>
              <div className="flex justify-center gap-4 mb-6">
                <div className="bg-blue-50 rounded-xl px-5 py-3">
                  <p className="text-xs text-blue-400 font-medium">Train</p>
                  <p className="text-2xl font-bold text-blue-700">
                    {split.trainImages.length}
                  </p>
                  <p className="text-xs text-blue-400">images</p>
                </div>
                <div className="bg-amber-50 rounded-xl px-5 py-3">
                  <p className="text-xs text-amber-500 font-medium">Valid</p>
                  <p className="text-2xl font-bold text-amber-700">
                    {split.validImages.length}
                  </p>
                  <p className="text-xs text-amber-500">images</p>
                </div>
              </div>
              <p className="text-xs text-slate-400">
                Files have been copied into train_old and valid_old. Next steps
                (tiling, annotation review) coming soon.
              </p>
              <button
                onClick={handleBackFromSplit}
                className="mt-6 text-sm text-slate-500 hover:text-slate-700"
              >
                Adjust split
              </button>
            </div>
          </div>
        )}

        {stage === "tiling" && tilingProgress && (
          <div className="w-full max-w-md mx-auto">
            <div className="bg-white border border-slate-200 rounded-2xl p-8 text-center shadow-sm">
              <div className="w-16 h-16 rounded-full bg-blue-50 flex items-center justify-center mx-auto mb-4">
                <Loader2 className="w-8 h-8 text-blue-600 animate-spin" />
              </div>
              <h2 className="text-xl font-bold text-slate-800 mb-2">
                Tiling images...
              </h2>
              <p className="text-sm text-slate-500 mb-4">
                {tilingProgress.current + 1} / {tilingProgress.total}
              </p>
              <div className="w-full bg-slate-100 rounded-full h-2 mb-3">
                <div
                  className="bg-blue-500 h-2 rounded-full transition-all"
                  style={{
                    width: `${((tilingProgress.current + 1) / tilingProgress.total) * 100}%`,
                  }}
                />
              </div>
              <p className="text-xs text-slate-400 truncate">
                {tilingProgress.imageName}
              </p>
            </div>
          </div>
        )}

        {stage === "tiled" && tiled && (
          <div className="w-full max-w-2xl mx-auto">
            <div className="bg-white border border-slate-200 rounded-2xl p-8 text-center shadow-sm">
              <div className="w-16 h-16 rounded-full bg-green-50 flex items-center justify-center mx-auto mb-4">
                <CheckCircle2 className="w-8 h-8 text-green-600" />
              </div>
              <h2 className="text-xl font-bold text-slate-800 mb-2">
                Tiling complete
              </h2>
              {tiled.smallBoxesRemoved && (
                <div className="mb-4 text-sm text-slate-600">
                  <p>Small Box Area Threshold: {tiled.smallBoxThreshold ?? 0} px²</p>
                  <p>Minimum Retained Percentage: {tiled.minRetainedPercentage ?? 0}%</p>
                  <p>Sliver Minimum Side: {tiled.sliverMinSide ?? 0} px; Sliver Aspect Ratio: {tiled.sliverAspectRatio ?? 0}</p>
                  <p>Removed by small-area filter: {tiled.smallBoxesRemoved.train + tiled.smallBoxesRemoved.valid} (Train: {tiled.smallBoxesRemoved.train}, Valid: {tiled.smallBoxesRemoved.valid})</p>
                  <p>Removed as clipped fragments: {(tiled.clippedFragmentsRemoved?.train ?? 0) + (tiled.clippedFragmentsRemoved?.valid ?? 0)} (Train: {tiled.clippedFragmentsRemoved?.train ?? 0}, Valid: {tiled.clippedFragmentsRemoved?.valid ?? 0})</p>
                  <p>Removed by sliver filter: {(tiled.sliverBoxesRemoved?.train ?? 0) + (tiled.sliverBoxesRemoved?.valid ?? 0)} (Train: {tiled.sliverBoxesRemoved?.train ?? 0}, Valid: {tiled.sliverBoxesRemoved?.valid ?? 0})</p>
                  <p>Total removed: {tiled.smallBoxesRemoved.train + tiled.smallBoxesRemoved.valid + (tiled.clippedFragmentsRemoved?.train ?? 0) + (tiled.clippedFragmentsRemoved?.valid ?? 0) + (tiled.sliverBoxesRemoved?.train ?? 0) + (tiled.sliverBoxesRemoved?.valid ?? 0)}</p>
                </div>
              )}
              <div className="flex justify-center gap-4 mb-6">
                <div className="bg-blue-50 rounded-xl px-5 py-3">
                  <p className="text-xs text-blue-400 font-medium">Train tiles</p>
                  <p className="text-2xl font-bold text-blue-700">
                    {tiled.trainImages.length}
                  </p>
                  <p className="text-xs text-blue-400">images</p>
                </div>
                <div className="bg-amber-50 rounded-xl px-5 py-3">
                  <p className="text-xs text-amber-500 font-medium">Valid tiles</p>
                  <p className="text-2xl font-bold text-amber-700">
                    {tiled.validImages.length}
                  </p>
                  <p className="text-xs text-amber-500">images</p>
                </div>
              </div>
              <div className="flex items-center justify-center gap-3">
                <button
                  onClick={handleGoToTileViewer}
                  className="px-6 py-3 rounded-xl bg-slate-900 text-white font-semibold text-sm hover:bg-slate-800 transition-colors inline-flex items-center gap-2"
                >
                  View Tiles
                  <ArrowRight className="w-4 h-4" />
                </button>
                {!finalization?.oldFoldersDeleted && (
                  <button
                    onClick={handleBackFromTiled}
                    className="text-sm text-slate-500 hover:text-slate-700"
                  >
                    Adjust split
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        {stage === "tile-viewer" && tiled && (
          <TileViewer
            tiled={tiled}
            objNamesText={session?.objNames?.text ?? null}
            onBack={handleBackFromTileViewer}
            onSave={handleSaveLabel}
            onFinalize={handleGoToFinalization}
          />
        )}

        {stage === "finalizing" && (
          <div className="flex items-center justify-center py-20 text-sm text-slate-500">
            <Loader2 className="w-4 h-4 animate-spin mr-2" /> Opening finalization...
          </div>
        )}

        {stage === "finalization-summary" && tiled && session && (
          <FinalizationSummary
            tiled={tiled}
            objNamesText={session.objNames?.text ?? null}
            zipBaseName={session.zipBaseName}
            oldFoldersDeleted={finalization?.oldFoldersDeleted ?? false}
            cachedZip={finalZip}
            onConfirm={handleFinalize}
            onBackToEditor={handleBackFromFinalization}
            onDeleteOldFolders={handleDeleteOldFolders}
          />
        )}

        {stage === "finalized" && session && (
          <div className="max-w-2xl mx-auto">
            <div className="bg-white border border-slate-200 rounded-2xl p-8 text-center shadow-sm">
              <div className="w-16 h-16 rounded-full bg-green-50 flex items-center justify-center mx-auto mb-4">
                <CheckCircle2 className="w-8 h-8 text-green-600" />
              </div>
              <h2 className="text-xl font-bold text-slate-800 mb-2">
                Dataset finalized
              </h2>
              <p className="text-sm text-slate-500 mb-6">
                Your RFDETR training dataset is ready to download.
                {finalization?.oldFoldersDeleted && (
                  <> Intermediate source data has been cleaned up.</>
                )}
              </p>
              {finalZip && (
                <FinalizedDownload
                  zipBlob={finalZip}
                  folderName={`RFDETR_${session.zipBaseName.replace(/_backup$/, "")}`}
                />
              )}
              <div className="flex items-center justify-center gap-3 mt-6">
                {tiled && (
                  <button
                    onClick={handleBackFromFinalized}
                    className="px-6 py-3 rounded-xl bg-slate-100 text-slate-700 font-semibold text-sm hover:bg-slate-200 transition-colors"
                  >
                    Back to editor
                  </button>
                )}
                {!finalization?.oldFoldersDeleted && tiled && (
                  <button
                    onClick={() => { void handleDeleteOldFolders().catch((error) => {
                      setActionError(error instanceof Error ? error.message : "Could not delete intermediate data.");
                    }); }}
                    className="px-6 py-3 rounded-xl bg-slate-100 text-slate-700 font-semibold text-sm hover:bg-slate-200 transition-colors"
                  >
                    Delete intermediate data
                  </button>
                )}
                <button
                  onClick={handleStartFresh}
                  className="px-6 py-3 rounded-xl bg-slate-100 text-slate-700 font-semibold text-sm hover:bg-slate-200 transition-colors inline-flex items-center gap-2"
                >
                  <RotateCcw className="w-4 h-4" />
                  Start over
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

import { useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  ArrowLeft,
  AlertTriangle,
  Package,
  Image as ImageIcon,
  Tag,
  Loader2,
  Download,
  Trash2,
  FileArchive,
} from "lucide-react";
import type { TiledData } from "@/lib/types";
import {
  computeFinalSummaryAsync,
  buildFinalZip,
  type FinalSummary,
  type ZipBuildProgress,
} from "@/lib/finalization";

interface FinalizationSummaryProps {
  tiled: TiledData;
  objNamesText: string | null;
  zipBaseName: string;
  oldFoldersDeleted: boolean;
  cachedZip: Blob | null;
  onConfirm: (zipBlob: Blob) => void;
  onBackToEditor: () => void;
  onDeleteOldFolders: () => void;
}

const CLASS_COLORS = [
  "#ef4444",
  "#f97316",
  "#eab308",
  "#22c55e",
  "#06b6d4",
  "#3b82f6",
  "#8b5cf6",
  "#ec4899",
  "#f43f5e",
  "#84cc16",
];

function getClassColor(cls: number): string {
  return CLASS_COLORS[cls % CLASS_COLORS.length];
}

export function FinalizationSummary({
  tiled,
  objNamesText,
  zipBaseName,
  oldFoldersDeleted,
  cachedZip,
  onConfirm,
  onBackToEditor,
  onDeleteOldFolders,
}: FinalizationSummaryProps) {
  const [summary, setSummary] = useState<FinalSummary | null>(null);
  const [zipProgress, setZipProgress] = useState<ZipBuildProgress | null>(null);
  const [zipBlob, setZipBlob] = useState<Blob | null>(cachedZip);
  const [building, setBuilding] = useState(false);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const classNames = useMemo(() => {
    if (!objNamesText) return [];
    return objNamesText.trim().split("\n");
  }, [objNamesText]);

  const folderName = zipBaseName.replace(/_backup$/, "");
  const zipFileName = `RFDETR_${folderName}`;

  useEffect(() => {
    computeFinalSummaryAsync(tiled, classNames).then(setSummary);
  }, [tiled, classNames]);

  useEffect(() => {
    if (zipBlob) {
      const url = URL.createObjectURL(zipBlob);
      setDownloadUrl(url);
      return () => URL.revokeObjectURL(url);
    }
  }, [zipBlob]);

  const handleBuildZip = async () => {
    setBuilding(true);
    setZipProgress({ current: 0, total: 0, fileName: "Starting..." });
    try {
      const blob = await buildFinalZip(
        tiled,
        objNamesText ?? "",
        folderName,
        (p) => setZipProgress(p),
      );
      setZipBlob(blob);
      onConfirm(blob);
    } catch {
      setZipProgress(null);
    } finally {
      setBuilding(false);
      setZipProgress(null);
    }
  };

  const totalFiles =
    tiled.trainImages.length +
    tiled.trainLabels.length +
    tiled.validImages.length +
    tiled.validLabels.length;

  return (
    <div className="max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-bold text-slate-800">
            Finalization Summary
          </h2>
          <p className="text-sm text-slate-500 mt-1">
            Review your dataset before exporting the final zip.
          </p>
        </div>
        <button
          onClick={onBackToEditor}
          className="text-sm text-slate-500 hover:text-slate-700 flex items-center gap-1.5 px-3 py-2 rounded-lg hover:bg-slate-100 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to editor
        </button>
      </div>

      <div className="space-y-4">
        {/* Stats card */}
        <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className="text-center">
              <div className="w-12 h-12 rounded-xl bg-blue-50 flex items-center justify-center mx-auto mb-2">
                <ImageIcon className="w-6 h-6 text-blue-600" />
              </div>
              <p className="text-2xl font-bold text-slate-800">
                {summary?.totalImages ?? "..."}
              </p>
              <p className="text-xs text-slate-400">Total tile images</p>
            </div>
            <div className="text-center">
              <div className="w-12 h-12 rounded-xl bg-green-50 flex items-center justify-center mx-auto mb-2">
                <Tag className="w-6 h-6 text-green-600" />
              </div>
              <p className="text-2xl font-bold text-slate-800">
                {summary?.totalAnnotations ?? "..."}
              </p>
              <p className="text-xs text-slate-400">Total annotations</p>
            </div>
            <div className="text-center">
              <div className="w-12 h-12 rounded-xl bg-purple-50 flex items-center justify-center mx-auto mb-2">
                <Package className="w-6 h-6 text-purple-600" />
              </div>
              <p className="text-2xl font-bold text-slate-800">
                {classNames.length}
              </p>
              <p className="text-xs text-slate-400">Classes</p>
            </div>
            <div className="text-center">
              <div className="w-12 h-12 rounded-xl bg-amber-50 flex items-center justify-center mx-auto mb-2">
                <FileArchive className="w-6 h-6 text-amber-600" />
              </div>
              <p className="text-2xl font-bold text-slate-800">
                {totalFiles}
              </p>
              <p className="text-xs text-slate-400">Files in zip</p>
            </div>
          </div>

          {/* Annotations per class breakdown */}
          {summary && summary.annotationsPerClass.size > 0 && (
            <div className="mt-6 pt-6 border-t border-slate-100">
              <h3 className="text-sm font-semibold text-slate-600 mb-3">
                Annotations per class
              </h3>
              <div className="space-y-2">
                {Array.from(summary.annotationsPerClass.entries())
                  .sort((a, b) => a[0] - b[0])
                  .map(([cls, count]) => (
                    <div
                      key={cls}
                      className="flex items-center gap-3"
                    >
                      <span
                        className="w-3 h-3 rounded-sm flex-shrink-0"
                        style={{ backgroundColor: getClassColor(cls) }}
                      />
                      <span className="text-sm text-slate-700 flex-1">
                        {classNames[cls] ?? `Class ${cls}`}
                      </span>
                      <span className="text-sm font-medium text-slate-500 tabular-nums">
                        {count}
                      </span>
                    </div>
                  ))}
              </div>
            </div>
          )}
        </div>

        {/* Old folders cleanup */}
        <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center flex-shrink-0">
              <Trash2 className="w-5 h-5 text-slate-600" />
            </div>
            <div className="flex-1">
              <h3 className="text-sm font-bold text-slate-800">
                Intermediate data cleanup
              </h3>
              <p className="text-sm text-slate-500 mt-1">
                The <code className="text-xs bg-slate-100 px-1 py-0.5 rounded font-mono">train_old</code> and{" "}
                <code className="text-xs bg-slate-100 px-1 py-0.5 rounded font-mono">valid_old</code> folders
                contain only the intermediate full-resolution source images used for tiling. They are
                not part of the final output and can be safely deleted to free up storage.
              </p>
              {oldFoldersDeleted ? (
                <div className="mt-3 flex items-center gap-2 text-sm text-green-600 font-medium">
                  <CheckCircle2 className="w-4 h-4" />
                  Intermediate folders deleted
                </div>
              ) : showDeleteConfirm ? (
                <div className="mt-3 flex items-center gap-2">
                  <span className="text-sm text-slate-600">
                    Are you sure?
                  </span>
                  <button
                    onClick={() => {
                      onDeleteOldFolders();
                      setShowDeleteConfirm(false);
                    }}
                    className="px-3 py-1.5 rounded-lg bg-red-600 text-white text-xs font-medium hover:bg-red-700 transition-colors"
                  >
                    Yes, delete
                  </button>
                  <button
                    onClick={() => setShowDeleteConfirm(false)}
                    className="px-3 py-1.5 rounded-lg bg-slate-100 text-slate-600 text-xs font-medium hover:bg-slate-200 transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setShowDeleteConfirm(true)}
                  className="mt-3 px-4 py-2 rounded-lg bg-slate-100 text-slate-700 text-sm font-medium hover:bg-slate-200 transition-colors"
                >
                  Delete intermediate folders
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Zip build + download */}
        <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-full bg-blue-50 flex items-center justify-center flex-shrink-0">
              <FileArchive className="w-5 h-5 text-blue-600" />
            </div>
            <div className="flex-1">
              <h3 className="text-sm font-bold text-slate-800">
                Export final zip
              </h3>
              <p className="text-sm text-slate-500 mt-1">
                Build a zip file named{" "}
                <code className="text-xs bg-slate-100 px-1 py-0.5 rounded font-mono">
                  {zipFileName}.zip
                </code>{" "}
                with the RFDETR-expected folder structure. The root folder and
                obj.names file will be prefixed with{" "}
                <code className="text-xs bg-slate-100 px-1 py-0.5 rounded font-mono">
                  RFDETR_{folderName}_
                </code>
                . Tile filenames use{" "}
                <code className="text-xs bg-slate-100 px-1 py-0.5 rounded font-mono">
                  {folderName}_
                </code>.
              </p>

              {building && zipProgress && (
                <div className="mt-4">
                  <div className="flex items-center justify-between text-xs text-slate-500 mb-1">
                    <span className="flex items-center gap-1.5">
                      <Loader2 className="w-3 h-3 animate-spin" />
                      {zipProgress.fileName}
                    </span>
                    <span className="tabular-nums">
                      {zipProgress.current} / {zipProgress.total}
                    </span>
                  </div>
                  <div className="w-full bg-slate-100 rounded-full h-2">
                    <div
                      className="bg-blue-500 h-2 rounded-full transition-all"
                      style={{
                        width: `${zipProgress.total > 0 ? (zipProgress.current / zipProgress.total) * 100 : 0}%`,
                      }}
                    />
                  </div>
                </div>
              )}

              {zipBlob && !building && (
                <div className="mt-4 space-y-3">
                  <div className="flex items-center gap-2 text-sm text-green-600 font-medium">
                    <CheckCircle2 className="w-4 h-4" />
                    Zip ready ({(zipBlob.size / 1024 / 1024).toFixed(1)} MB)
                  </div>
                  {downloadUrl && (
                    <a
                      href={downloadUrl}
                      download={`${zipFileName}.zip`}
                      className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-slate-900 text-white font-semibold text-sm hover:bg-slate-800 transition-colors"
                    >
                      <Download className="w-4 h-4" />
                      Download {zipFileName}.zip
                    </a>
                  )}
                </div>
              )}

              {!zipBlob && !building && (
                <button
                  onClick={handleBuildZip}
                  className="mt-4 inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-slate-900 text-white font-semibold text-sm hover:bg-slate-800 transition-colors"
                >
                  <FileArchive className="w-4 h-4" />
                  Build zip
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Unsaved warning */}
        {summary && summary.unsavedImages.length > 0 && (
          <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-amber-800">
                {summary.unsavedImages.length} image
                {summary.unsavedImages.length === 1 ? "" : "s"} with unsaved
                annotation changes
              </p>
              <p className="text-xs text-amber-600 mt-1">
                Go back to the editor to save these changes before finalizing, or
                proceed if you're okay with the current saved state.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

interface FinalizedDownloadProps {
  zipBlob: Blob;
  folderName: string;
}

export function FinalizedDownload({ zipBlob, folderName }: FinalizedDownloadProps) {
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);

  useEffect(() => {
    const url = URL.createObjectURL(zipBlob);
    setDownloadUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [zipBlob]);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-sm text-green-600 font-medium">
        <CheckCircle2 className="w-4 h-4" />
        Zip ready ({(zipBlob.size / 1024 / 1024).toFixed(1)} MB)
      </div>
      {downloadUrl && (
        <a
          href={downloadUrl}
          download={`${folderName}.zip`}
          className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-slate-900 text-white font-semibold text-sm hover:bg-slate-800 transition-colors"
        >
          <Download className="w-4 h-4" />
          Download {folderName}.zip
        </a>
      )}
    </div>
  );
}

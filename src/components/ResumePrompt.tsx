import { useEffect, useState } from "react";
import { FolderOpen, Trash2, HardDrive, Scissors } from "lucide-react";
import { getStorageEstimate } from "@/lib/db";

interface ResumePromptProps {
  onResume: () => void;
  onStartFresh: () => void;
  updatedAt: number;
  pairCount: number;
  hasSplit: boolean;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function ResumePrompt({
  onResume,
  onStartFresh,
  updatedAt,
  pairCount,
  hasSplit,
}: ResumePromptProps) {
  const [storage, setStorage] = useState<{
    usage: number;
    quota: number;
  } | null>(null);

  useEffect(() => {
    getStorageEstimate().then(setStorage);
  }, []);

  const dateStr = new Date(updatedAt).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

  return (
    <div className="w-full max-w-md mx-auto">
      <div className="bg-white border border-slate-200 rounded-2xl p-8 shadow-sm">
        <div className="w-14 h-14 rounded-xl bg-blue-50 flex items-center justify-center mx-auto mb-5">
          <FolderOpen className="w-7 h-7 text-blue-600" />
        </div>
        <h2 className="text-xl font-bold text-slate-800 text-center mb-2">
          Resume previous session?
        </h2>
        <p className="text-sm text-slate-500 text-center mb-2">
          We found a saved session from <span className="font-medium text-slate-600">{dateStr}</span> with {pairCount} validated image{pairCount === 1 ? "" : "s"}.
        </p>
        {hasSplit && (
          <div className="flex items-center justify-center gap-1.5 mb-6 text-xs text-slate-400">
            <Scissors className="w-3.5 h-3.5" />
            <span>Train/valid split already applied</span>
          </div>
        )}
        {!hasSplit && <div className="mb-6" />}

        {storage && storage.usage > 0 && (
          <div className="flex items-center gap-2 bg-slate-50 rounded-lg px-3 py-2 mb-6 text-xs text-slate-500">
            <HardDrive className="w-4 h-4 text-slate-400" />
            <span>
              Storage used: {formatBytes(storage.usage)}
              {storage.quota > 0 && ` of ${formatBytes(storage.quota)}`}
            </span>
          </div>
        )}

        <div className="space-y-3">
          <button
            onClick={onResume}
            className="w-full py-3.5 rounded-xl bg-slate-900 text-white font-semibold text-sm hover:bg-slate-800 transition-colors flex items-center justify-center gap-2"
          >
            Resume Session
          </button>
          <button
            onClick={onStartFresh}
            className="w-full py-3.5 rounded-xl border border-red-200 bg-red-50 text-red-600 font-semibold text-sm hover:bg-red-100 transition-colors flex items-center justify-center gap-2"
          >
            <Trash2 className="w-4 h-4" />
            Clear & Start Fresh
          </button>
        </div>
      </div>
    </div>
  );
}

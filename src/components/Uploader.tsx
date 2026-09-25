import { useCallback, useRef, useState } from "react";
import { UploadCloud, FileArchive, X, Loader2 } from "lucide-react";
import { formatSize } from "@/lib/format-size";

interface UploaderProps {
  onValidate: (file1: File, file2: File) => Promise<void>;
  isValidating: boolean;
}

export function Uploader({ onValidate, isValidating }: UploaderProps) {
  const [files, setFiles] = useState<File[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFiles = useCallback((incoming: FileList | null) => {
    if (!incoming) return;
    const zips = Array.from(incoming).filter(
      (f) => f.name.toLowerCase().endsWith(".zip"),
    );
    if (zips.length === 0) {
      setError("Please select .zip files.");
      return;
    }
    if (zips.length > 2) {
      setError("Please select exactly two zip files.");
      return;
    }
    setError(null);
    setFiles(zips);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      if (isValidating) return;
      handleFiles(e.dataTransfer.files);
    },
    [handleFiles, isValidating],
  );

  const handleValidate = useCallback(async () => {
    if (files.length !== 2) {
      setError("Exactly two zip files are required.");
      return;
    }
    await onValidate(files[0], files[1]);
  }, [files, onValidate]);

  const removeFile = useCallback((index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  }, []);

  return (
    <div className="w-full max-w-2xl mx-auto">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          if (!isValidating) setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        onClick={() => !isValidating && inputRef.current?.click()}
        className={`relative border-2 border-dashed rounded-2xl p-12 text-center cursor-pointer transition-all duration-200
          ${
            isDragging
              ? "border-blue-500 bg-blue-50 scale-[1.01]"
              : "border-slate-300 bg-slate-50/50 hover:border-slate-400 hover:bg-slate-50"
          }
          ${isValidating ? "opacity-60 pointer-events-none" : ""}`}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".zip"
          multiple
          className="hidden"
          onChange={(e) => handleFiles(e.target.files)}
        />
        <div className="flex flex-col items-center gap-4">
          <div
            className={`w-16 h-16 rounded-full flex items-center justify-center transition-colors
            ${isDragging ? "bg-blue-100" : "bg-slate-100"}`}
          >
            <UploadCloud
              className={`w-8 h-8 ${isDragging ? "text-blue-600" : "text-slate-400"}`}
            />
          </div>
          <div>
            <p className="text-lg font-semibold text-slate-800">
              Drop two zip files here
            </p>
            <p className="text-sm text-slate-500 mt-1">
              One <code className="text-slate-600 font-mono text-xs bg-slate-100 px-1.5 py-0.5 rounded">_backup.zip</code> with images in <span className="font-medium">data/</span>, and one without <span className="font-medium">_backup</span> with annotations in <span className="font-medium">obj_train_data/</span>
            </p>
          </div>
        </div>
      </div>

      {error && (
        <div className="mt-4 bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {files.length > 0 && (
        <div className="mt-6 space-y-3">
          {files.map((file, i) => (
            <div
              key={`${file.name}-${i}`}
              className="flex items-center gap-3 bg-white border border-slate-200 rounded-xl px-4 py-3 shadow-sm"
            >
              <div className="w-10 h-10 rounded-lg bg-amber-50 flex items-center justify-center flex-shrink-0">
                <FileArchive className="w-5 h-5 text-amber-600" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-slate-800 truncate">
                  {file.name}
                </p>
                <p className="text-xs text-slate-400">{formatSize(file.size)}</p>
              </div>
              {!isValidating && (
                <button
                  onClick={() => removeFile(i)}
                  className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
          ))}

          <button
            onClick={handleValidate}
            disabled={files.length !== 2 || isValidating}
            className="w-full py-3.5 rounded-xl bg-slate-900 text-white font-semibold text-sm hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
          >
            {isValidating ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Validating...
              </>
            ) : (
              "Validate Files"
            )}
          </button>
        </div>
      )}
    </div>
  );
}

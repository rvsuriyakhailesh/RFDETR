import { useMemo } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  FileX,
  ImageOff,
  Ruler,
  FileWarning,
  Copy,
  FolderX,
} from "lucide-react";
import type { ValidationIssue, ValidationIssueType } from "@/lib/types";

interface ValidationResultsProps {
  issues: ValidationIssue[];
  onSuccess: () => void;
  onReset: () => void;
}

const ISSUE_META: Record<
  ValidationIssueType,
  { label: string; icon: typeof AlertTriangle; color: string; bg: string }
> = {
  "filename-mismatch": {
    label: "Filename Mismatch",
    icon: FileWarning,
    color: "text-red-600",
    bg: "bg-red-50",
  },
  "orphaned-image": {
    label: "Orphaned Images",
    icon: ImageOff,
    color: "text-orange-600",
    bg: "bg-orange-50",
  },
  "orphaned-annotation": {
    label: "Orphaned Annotations",
    icon: FileX,
    color: "text-orange-600",
    bg: "bg-orange-50",
  },
  resolution: {
    label: "Resolution Errors",
    icon: Ruler,
    color: "text-red-600",
    bg: "bg-red-50",
  },
  "missing-obj-names": {
    label: "Missing obj.names",
    icon: FileX,
    color: "text-red-600",
    bg: "bg-red-50",
  },
  "duplicate-filename": {
    label: "Duplicate Filenames",
    icon: Copy,
    color: "text-orange-600",
    bg: "bg-orange-50",
  },
  "invalid-annotation": {
    label: "Invalid Annotations",
    icon: FileWarning,
    color: "text-red-600",
    bg: "bg-red-50",
  },
  "zip-structure": {
    label: "Zip Structure Errors",
    icon: FolderX,
    color: "text-red-600",
    bg: "bg-red-50",
  },
};

export function ValidationResults({
  issues,
  onSuccess,
  onReset,
}: ValidationResultsProps) {
  const grouped = useMemo(() => {
    const map = new Map<ValidationIssueType, ValidationIssue[]>();
    for (const issue of issues) {
      const list = map.get(issue.type) ?? [];
      list.push(issue);
      map.set(issue.type, list);
    }
    return map;
  }, [issues]);

  const hasBlocking = issues.some(
    (i) =>
      i.type === "filename-mismatch" ||
      i.type === "zip-structure" ||
      i.type === "missing-obj-names" ||
      i.type === "orphaned-image" ||
      i.type === "orphaned-annotation" ||
      i.type === "duplicate-filename" ||
      i.type === "invalid-annotation" ||
      i.type === "resolution",
  );

  if (issues.length === 0) {
    return (
      <div className="w-full max-w-2xl mx-auto">
        <div className="bg-white border border-slate-200 rounded-2xl p-8 text-center shadow-sm">
          <div className="w-16 h-16 rounded-full bg-green-50 flex items-center justify-center mx-auto mb-4">
            <CheckCircle2 className="w-8 h-8 text-green-600" />
          </div>
          <h2 className="text-xl font-bold text-slate-800 mb-2">
            All checks passed
          </h2>
          <p className="text-sm text-slate-500 mb-6">
            Your zip files are valid and ready for the next step.
          </p>
          <button
            onClick={onSuccess}
            className="px-6 py-3 rounded-xl bg-slate-900 text-white font-semibold text-sm hover:bg-slate-800 transition-colors"
          >
            Continue
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full max-w-3xl mx-auto">
      <div className="mb-6">
        <div className="flex items-center gap-3 mb-2">
          <div className="w-10 h-10 rounded-lg bg-red-50 flex items-center justify-center">
            <AlertTriangle className="w-5 h-5 text-red-600" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-slate-800">
              Validation found {issues.length} {issues.length === 1 ? "issue" : "issues"}
            </h2>
            <p className="text-sm text-slate-500">
              Fix all issues below, then re-upload your zip files.
            </p>
          </div>
        </div>
      </div>

      <div className="space-y-4">
        {Array.from(grouped.entries()).map(([type, items]) => {
          const meta = ISSUE_META[type];
          const Icon = meta.icon;
          return (
            <div
              key={type}
              className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm"
            >
              <div className={`flex items-center gap-3 px-5 py-3 ${meta.bg}`}>
                <Icon className={`w-5 h-5 ${meta.color}`} />
                <span className={`font-semibold text-sm ${meta.color}`}>
                  {meta.label}
                </span>
                <span className="ml-auto text-xs font-medium text-slate-400">
                  {items.length} {items.length === 1 ? "item" : "items"}
                </span>
              </div>
              <div className="divide-y divide-slate-100">
                {items.map((item, i) => (
                  <div
                    key={`${type}-${i}`}
                    className="flex items-start gap-3 px-5 py-3"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-slate-700 truncate">
                        {item.filename}
                      </p>
                      <p className="text-xs text-slate-500 mt-0.5">
                        {item.reason}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-6 flex gap-3">
        <button
          onClick={onReset}
          className="flex-1 py-3 rounded-xl border border-slate-200 bg-white text-slate-700 font-semibold text-sm hover:bg-slate-50 transition-colors"
        >
          Re-upload Files
        </button>
      </div>

      {hasBlocking && (
        <p className="mt-4 text-center text-xs text-slate-400">
          All issues must be resolved before continuing to the next step.
        </p>
      )}
    </div>
  );
}

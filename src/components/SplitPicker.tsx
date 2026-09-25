import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Scissors,
  Check,
  Search,
  Train,
  TestTube,
  X,
} from "lucide-react";
import type { ValidatedPair, SplitData } from "@/lib/types";
import { DEFAULT_SMALL_BOX_THRESHOLD, DEFAULT_MIN_RETAINED_PERCENTAGE, sanitizeSmallBoxThreshold, sanitizeMinRetainedPercentage } from "@/lib/tiling-settings";
import { DEFAULT_SLIVER_MIN_SIDE, DEFAULT_SLIVER_ASPECT_RATIO, sanitizeSliverValue } from "@/lib/tiling-settings";

interface SplitPickerProps {
  pairs: ValidatedPair[];
  initialSplitIndex: number;
  initialSmallBoxThreshold?: number;
  initialMinRetainedPercentage?: number;
  initialSliverMinSide?: number;
  initialSliverAspectRatio?: number;
  onConfirm: (splitIndex: number, smallBoxThreshold: number, minRetainedPercentage: number, sliverMinSide: number, sliverAspectRatio: number) => Promise<void>;
  onBack: () => void;
}

function getBaseName(filename: string): string {
  const dot = filename.lastIndexOf(".");
  return dot >= 0 ? filename.substring(0, dot) : filename;
}

export function SplitPicker({
  pairs,
  initialSplitIndex,
  initialSmallBoxThreshold = DEFAULT_SMALL_BOX_THRESHOLD,
  initialMinRetainedPercentage = DEFAULT_MIN_RETAINED_PERCENTAGE,
  initialSliverMinSide = DEFAULT_SLIVER_MIN_SIDE,
  initialSliverAspectRatio = DEFAULT_SLIVER_ASPECT_RATIO,
  onConfirm,
  onBack,
}: SplitPickerProps) {
  const sorted = useMemo(
    () => [...pairs].sort((a, b) => a.image.name.localeCompare(b.image.name)),
    [pairs],
  );

  const [currentIndex, setCurrentIndex] = useState(initialSplitIndex);
  const [splitIndex, setSplitIndex] = useState(initialSplitIndex);
  const [thresholdInput, setThresholdInput] = useState(String(sanitizeSmallBoxThreshold(initialSmallBoxThreshold)));
  const [retainedInput, setRetainedInput] = useState(String(sanitizeMinRetainedPercentage(initialMinRetainedPercentage)));
  const [sliverSideInput, setSliverSideInput] = useState(String(sanitizeSliverValue(initialSliverMinSide)));
  const [sliverRatioInput, setSliverRatioInput] = useState(String(sanitizeSliverValue(initialSliverAspectRatio)));
  const [imageUrls, setImageUrls] = useState<Map<string, string>>(new Map());
  const [search, setSearch] = useState("");
  const [showSearch, setShowSearch] = useState(false);
  const [isConfirming, setIsConfirming] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const currentPair = sorted[currentIndex];

  useEffect(() => {
    const urls = new Map<string, string>();
    for (const pair of sorted) {
      urls.set(pair.image.name, URL.createObjectURL(pair.image.blob));
    }
    setImageUrls(urls);
    return () => {
      for (const url of urls.values()) {
        URL.revokeObjectURL(url);
      }
    };
  }, [sorted]);

  const goTo = useCallback(
    (index: number) => {
      if (index >= 0 && index < sorted.length) {
        setCurrentIndex(index);
      }
    },
    [sorted.length],
  );

  const goPrev = useCallback(() => goTo(currentIndex - 1), [currentIndex, goTo]);
  const goNext = useCallback(() => goTo(currentIndex + 1), [currentIndex, goTo]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      if (showSearch && document.activeElement === searchInputRef.current) return;
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        goPrev();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        goNext();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [goPrev, goNext, showSearch]);

  useEffect(() => {
    if (showSearch && searchInputRef.current) {
      searchInputRef.current.focus();
    }
  }, [showSearch]);

  const handleSearchSubmit = useCallback(() => {
    if (!search.trim()) {
      setShowSearch(false);
      return;
    }
    const query = search.toLowerCase().trim();
    const found = sorted.findIndex((p) =>
      p.image.name.toLowerCase().includes(query),
    );
    if (found >= 0) {
      setCurrentIndex(found);
    }
    setShowSearch(false);
    setSearch("");
  }, [search, sorted]);

  const handleMarkSplit = useCallback(() => {
    setSplitIndex(currentIndex);
  }, [currentIndex]);

  const handleConfirm = useCallback(async () => {
    setIsConfirming(true);
    try {
      const threshold = sanitizeSmallBoxThreshold(thresholdInput);
      setThresholdInput(String(threshold));
      const retained = sanitizeMinRetainedPercentage(retainedInput);
      setRetainedInput(String(retained));
      const side = sanitizeSliverValue(sliverSideInput);
      const ratio = sanitizeSliverValue(sliverRatioInput);
      setSliverSideInput(String(side));
      setSliverRatioInput(String(ratio));
      await onConfirm(splitIndex, threshold, retained, side, ratio);
    } finally {
      setIsConfirming(false);
    }
  }, [splitIndex, onConfirm, thresholdInput, retainedInput, sliverSideInput, sliverRatioInput]);

  const trainCount = splitIndex + 1;
  const validCount = sorted.length - trainCount;
  const trainPct = Math.round((trainCount / sorted.length) * 100);
  const validPct = 100 - trainPct;

  const currentImageUrl = currentPair
    ? imageUrls.get(currentPair.image.name)
    : undefined;

  const isTrain = (index: number) => index <= splitIndex;

  return (
    <div className="max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-xl font-bold text-slate-800">
            Choose train/valid split point
          </h2>
          <p className="text-sm text-slate-500 mt-1">
            Navigate with arrow keys. Mark the last image that belongs to
            train — everything after goes to valid.
          </p>
        </div>
        <button
          onClick={onBack}
          className="text-sm text-slate-500 hover:text-slate-700 flex items-center gap-1.5 px-3 py-2 rounded-lg hover:bg-slate-100 transition-colors"
        >
          <X className="w-4 h-4" />
          Cancel
        </button>
      </div>

      <div className="mb-4 rounded-xl border border-slate-200 bg-white p-4">
        <h3 className="font-semibold text-slate-800">Small Box Area Threshold</h3>
        <div className="mt-2 flex items-center gap-2 flex-wrap">
          <label htmlFor="small-box-threshold" className="text-sm text-slate-600">Minimum bounding-box area:</label>
          <input id="small-box-threshold" type="number" min={0} step={1}
            value={thresholdInput} disabled={isConfirming}
            onChange={(event) => setThresholdInput(event.target.value)}
            onBlur={() => setThresholdInput(String(sanitizeSmallBoxThreshold(thresholdInput)))}
            aria-describedby="small-box-threshold-help"
            className="w-28 rounded-lg border border-slate-300 px-3 py-2 text-sm" />
          <span className="text-sm text-slate-600">px²</span>
        </div>
        <p id="small-box-threshold-help" className="mt-2 text-sm text-slate-500">
          Boxes with an area smaller than this value after image splitting will be removed.
          Set to 0 to disable.
        </p>
        <div className="mt-4">
          <label htmlFor="min-retained-percentage" className="block font-semibold text-slate-800">Minimum Box Retained After Split</label>
          <div className="mt-2 flex items-center gap-2">
            <input id="min-retained-percentage" type="number" min={0} max={100} step="any"
              value={retainedInput} disabled={isConfirming}
              onChange={(event) => setRetainedInput(event.target.value)}
              onBlur={() => setRetainedInput(String(sanitizeMinRetainedPercentage(retainedInput)))}
              aria-describedby="min-retained-help"
              className="w-28 rounded-lg border border-slate-300 px-3 py-2 text-sm" />
            <span className="text-sm text-slate-600">%</span>
          </div>
          <p id="min-retained-help" className="mt-2 text-sm text-slate-500">
            Removes tiny fragments created when a bounding box is clipped by the tile boundary.
            Example: 10% means a clipped fragment is removed if less than 10% of the original box remains.
            Set to 0% to disable.
          </p>
        </div>
      </div>

      <div className="mb-4 rounded-xl border border-slate-200 bg-white p-4">
        <h3 className="font-semibold text-slate-800">Remove Narrow / Sliver Boxes</h3>
        <div className="mt-2 flex flex-wrap items-center gap-4">
          <div>
            <label htmlFor="sliver-min-side" className="block text-sm text-slate-600">Sliver Minimum Side</label>
            <input id="sliver-min-side" type="number" min={0} step="any" value={sliverSideInput} disabled={isConfirming}
              onChange={(event) => setSliverSideInput(event.target.value)}
              onBlur={() => setSliverSideInput(String(sanitizeSliverValue(sliverSideInput)))}
              aria-describedby="sliver-help" className="mt-1 w-28 rounded-lg border border-slate-300 px-3 py-2 text-sm" />
            <span className="ml-2 text-sm text-slate-600">px</span>
          </div>
          <div>
            <label htmlFor="sliver-aspect-ratio" className="block text-sm text-slate-600">Sliver Aspect Ratio</label>
            <input id="sliver-aspect-ratio" type="number" min={0} step="any" value={sliverRatioInput} disabled={isConfirming}
              onChange={(event) => setSliverRatioInput(event.target.value)}
              onBlur={() => setSliverRatioInput(String(sanitizeSliverValue(sliverRatioInput)))}
              aria-describedby="sliver-help" className="mt-1 w-28 rounded-lg border border-slate-300 px-3 py-2 text-sm" />
          </div>
        </div>
        <p id="sliver-help" className="mt-2 text-sm text-slate-500">
          Removes extremely narrow fragments created during image splitting. A box is removed only when it was clipped by the tile boundary,
          its smallest side is below the configured pixel value, and its aspect ratio is above the configured ratio.
          Set either value to 0 to disable this filter.
        </p>
      </div>

      <div className="flex gap-4 mb-4">
        <div className="flex-1 bg-white border border-slate-200 rounded-xl px-4 py-3 flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-blue-50 flex items-center justify-center">
            <Train className="w-4.5 h-4.5 text-blue-600" />
          </div>
          <div>
            <p className="text-xs text-slate-400">Train</p>
            <p className="text-sm font-bold text-slate-700">
              {trainCount} images ({trainPct}%)
            </p>
          </div>
        </div>
        <div className="flex-1 bg-white border border-slate-200 rounded-xl px-4 py-3 flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-amber-50 flex items-center justify-center">
            <TestTube className="w-4.5 h-4.5 text-amber-600" />
          </div>
          <div>
            <p className="text-xs text-slate-400">Valid</p>
            <p className="text-sm font-bold text-slate-700">
              {validCount} images ({validPct}%)
            </p>
          </div>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-100 bg-slate-50">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-slate-600">
              {currentIndex + 1} / {sorted.length}
            </span>
            <span
              className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                isTrain(currentIndex)
                  ? "bg-blue-100 text-blue-700"
                  : "bg-amber-100 text-amber-700"
              }`}
            >
              {isTrain(currentIndex) ? "Train" : "Valid"}
            </span>
          </div>
          <div className="flex items-center gap-1">
            {showSearch ? (
              <div className="flex items-center gap-1">
                <input
                  ref={searchInputRef}
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleSearchSubmit();
                    if (e.key === "Escape") {
                      setShowSearch(false);
                      setSearch("");
                    }
                  }}
                  onBlur={() => {
                    if (!search.trim()) setShowSearch(false);
                  }}
                  placeholder="Filename..."
                  className="text-sm px-2 py-1 w-40 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-300"
                />
                <button
                  onClick={handleSearchSubmit}
                  className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500"
                >
                  <Search className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <button
                onClick={() => setShowSearch(true)}
                className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500"
                title="Search"
              >
                <Search className="w-4 h-4" />
              </button>
            )}
            <button
              onClick={goPrev}
              disabled={currentIndex === 0}
              className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-600 disabled:opacity-30 disabled:hover:bg-transparent"
              title="Previous (←)"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
            <button
              onClick={goNext}
              disabled={currentIndex === sorted.length - 1}
              className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-600 disabled:opacity-30 disabled:hover:bg-transparent"
              title="Next (→)"
            >
              <ChevronRight className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="relative bg-slate-900 flex items-center justify-center min-h-[400px]">
          {currentImageUrl ? (
            <img
              src={currentImageUrl}
              alt={currentPair.image.name}
              className="max-w-full max-h-[60vh] object-contain"
            />
          ) : (
            <div className="text-slate-500 text-sm">Loading image...</div>
          )}

          <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-slate-900/80 to-transparent px-4 py-3">
            <p className="text-white text-sm font-medium truncate">
              {currentPair?.image.name}
            </p>
            <p className="text-slate-300 text-xs">
              {currentPair?.image.width}x{currentPair?.image.height}
            </p>
          </div>
        </div>
      </div>

      <div className="mt-4 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 text-sm text-slate-500">
          <Scissors className="w-4 h-4" />
          <span>
            Split after image{" "}
            <span className="font-semibold text-slate-700">
              {sorted[splitIndex]?.image.name ?? "—"}
            </span>{" "}
            (index {splitIndex})
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleMarkSplit}
            className="px-4 py-2.5 rounded-xl border border-slate-200 bg-white text-slate-700 font-semibold text-sm hover:bg-slate-50 transition-colors flex items-center gap-2"
          >
            <Scissors className="w-4 h-4" />
            Mark Split Here
          </button>
          <button
            onClick={handleConfirm}
            disabled={isConfirming}
            className="px-5 py-2.5 rounded-xl bg-slate-900 text-white font-semibold text-sm hover:bg-slate-800 disabled:opacity-50 transition-colors flex items-center gap-2"
          >
            <Check className="w-4 h-4" />
            {isConfirming ? "Confirming..." : "Confirm Split"}
          </button>
        </div>
      </div>

      <div className="mt-4 bg-white border border-slate-200 rounded-xl p-3 max-h-32 overflow-y-auto">
        <div className="flex flex-wrap gap-1">
          {sorted.map((pair, i) => (
            <button
              key={pair.image.name}
              onClick={() => goTo(i)}
              title={pair.image.name}
              className={`w-2.5 h-2.5 rounded-full transition-all ${
                i === currentIndex
                  ? "ring-2 ring-slate-900 ring-offset-1 scale-125"
                  : ""
              } ${
                i <= splitIndex
                  ? "bg-blue-500"
                  : "bg-amber-400"
              }`}
            />
          ))}
        </div>
        <div className="flex items-center gap-4 mt-2 text-xs text-slate-400">
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-blue-500" /> Train
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-amber-400" /> Valid
          </span>
        </div>
      </div>
    </div>
  );
}

export function computeSplitData(
  pairs: ValidatedPair[],
  splitIndex: number,
  smallBoxThreshold = 0,
  minRetainedPercentage = 0,
  sliverMinSide = 0,
  sliverAspectRatio = 0,
): SplitData {
  const sorted = [...pairs].sort((a, b) =>
    a.image.name.localeCompare(b.image.name),
  );

  const trainPairs = sorted.slice(0, splitIndex + 1);
  const validPairs = sorted.slice(splitIndex + 1);

  const toSplitFile = (pair: ValidatedPair, isImage: boolean) => ({
    name: isImage ? pair.image.name : getBaseName(pair.annotation.name) + ".txt",
    blob: isImage ? pair.image.blob : new Blob([pair.annotation.text], { type: "text/plain" }),
  });

  return {
    smallBoxThreshold: sanitizeSmallBoxThreshold(smallBoxThreshold),
    minRetainedPercentage: sanitizeMinRetainedPercentage(minRetainedPercentage),
    sliverMinSide: sanitizeSliverValue(sliverMinSide),
    sliverAspectRatio: sanitizeSliverValue(sliverAspectRatio),
    splitIndex,
    trainImages: trainPairs.map((p) => toSplitFile(p, true)),
    trainLabels: trainPairs.map((p) => toSplitFile(p, false)),
    validImages: validPairs.map((p) => toSplitFile(p, true)),
    validLabels: validPairs.map((p) => toSplitFile(p, false)),
    splitAt: Date.now(),
  };
}

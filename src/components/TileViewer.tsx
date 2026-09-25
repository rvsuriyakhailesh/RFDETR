import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  X,
  Train,
  TestTube,
  Tag,
  Maximize2,
  Minimize2,
  ZoomIn,
  ZoomOut,
  MousePointerClick,
  Trash2,
  Undo2,
  Save,
  Eye,
  EyeOff,
  Pencil,
  Copy,
  ClipboardPaste,
  Check,
  AlertCircle,
  CheckCircle2,
} from "lucide-react";
import type { TiledData, TiledFile } from "@/lib/types";
import { imageNumberToIndex, moveSelectedBoxes } from "@/lib/editor";
import { parseYoloText, formatYoloLine, type YoloLine, type RecomputedLine } from "@/lib/tiling";

interface TileViewerProps {
  tiled: TiledData;
  objNamesText: string | null;
  onBack: () => void;
  onSave: (split: "train" | "valid", labelName: string, text: string) => void;
  onFinalize: () => void;
}

interface TileEntry {
  image: TiledFile;
  label: TiledFile;
  split: "train" | "valid";
}

interface Transform {
  zoom: number;
  panX: number;
  panY: number;
}

type Tool = "pan" | "draw";

const MIN_ZOOM = 1;
const MAX_ZOOM = 20;
const RESET_TRANSFORM: Transform = { zoom: 1, panX: 0, panY: 0 };
const HANDLE_PX = 10;
const MIN_BOX_SIZE = 0.002;

const HANDLES = [
  { id: "nw", left: "0%", top: "0%", cursor: "nwse-resize" },
  { id: "n", left: "50%", top: "0%", cursor: "ns-resize" },
  { id: "ne", left: "100%", top: "0%", cursor: "nesw-resize" },
  { id: "e", left: "100%", top: "50%", cursor: "ew-resize" },
  { id: "se", left: "100%", top: "100%", cursor: "nwse-resize" },
  { id: "s", left: "50%", top: "100%", cursor: "ns-resize" },
  { id: "sw", left: "0%", top: "100%", cursor: "nesw-resize" },
  { id: "w", left: "0%", top: "50%", cursor: "ew-resize" },
] as const;

function buildEntries(tiled: TiledData): TileEntry[] {
  const labelByName = new Map<string, TiledFile>();
  for (const l of tiled.trainLabels) labelByName.set(l.name, l);
  for (const l of tiled.validLabels) labelByName.set(l.name, l);

  const entries: TileEntry[] = [];

  for (const img of tiled.trainImages) {
    const base = img.name.replace(/\.[^.]+$/, "");
    const label = labelByName.get(`${base}.txt`);
    if (label) entries.push({ image: img, label, split: "train" });
  }
  for (const img of tiled.validImages) {
    const base = img.name.replace(/\.[^.]+$/, "");
    const label = labelByName.get(`${base}.txt`);
    if (label) entries.push({ image: img, label, split: "valid" });
  }

  entries.sort((a, b) => a.image.name.localeCompare(b.image.name));
  return entries;
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

function labelsToText(labels: YoloLine[]): string {
  return labels
    .map((l) => formatYoloLine(l as RecomputedLine))
    .join("\n");
}

export function TileViewer({ tiled, objNamesText, onBack, onSave, onFinalize }: TileViewerProps) {
  const entries = useMemo(() => buildEntries(tiled), [tiled]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [imageNumber, setImageNumber] = useState("1");
  const [navigationError, setNavigationError] = useState("");
  const [labelsLoading, setLabelsLoading] = useState(true);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [labels, setLabels] = useState<YoloLine[]>([]);
  const [savedLabels, setSavedLabels] = useState<YoloLine[]>([]);
  const [showClassNames, setShowClassNames] = useState(false);
  const [showBoxes, setShowBoxes] = useState(true);
  const [showManBoxes, setShowManBoxes] = useState(true);
  const [showChairBoxes, setShowChairBoxes] = useState(true);
  const [transform, setTransform] = useState<Transform>(RESET_TRANSFORM);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [tool, setTool] = useState<Tool>("pan");
  const [selectedBoxes, setSelectedBoxes] = useState<Set<number>>(new Set());
  const [copiedBoxes, setCopiedBoxes] = useState<YoloLine[]>([]);
  const [undoSnapshot, setUndoSnapshot] = useState<YoloLine[] | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isDrawing, setIsDrawing] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const [isMovingBox, setIsMovingBox] = useState(false);
  const [drawRect, setDrawRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [pendingDraw, setPendingDraw] = useState<YoloLine | null>(null);
  const [showUnsavedDialog, setShowUnsavedDialog] = useState(false);
  const [pendingNavigate, setPendingNavigate] = useState<number | null>(null);
  const [justSaved, setJustSaved] = useState(false);

  const viewportRef = useRef<HTMLDivElement>(null);
  const fullscreenRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const dragState = useRef<{
    startX: number;
    startY: number;
    panX: number;
    panY: number;
  } | null>(null);
  const drawState = useRef<{
    startNormX: number;
    startNormY: number;
  } | null>(null);
  const resizeState = useRef<{
    handle: string;
    origLeft: number;
    origTop: number;
    origRight: number;
    origBottom: number;
  } | null>(null);
  const moveBoxState = useRef<{
    startNormX: number;
    startNormY: number;
    startX: number;
    startY: number;
    original: YoloLine[];
    selected: Set<number>;
    clickTarget: number;
    started: boolean;
  } | null>(null);
  const cycleState = useRef<{
    lastClickX: number;
    lastClickY: number;
    hitIndices: number[];
    cyclePos: number;
  } | null>(null);
  const didMoveRef = useRef(false);
  const transformRef = useRef(transform);
  transformRef.current = transform;
  const labelsRef = useRef(labels);
  labelsRef.current = labels;
  const savedLabelsRef = useRef(savedLabels);
  savedLabelsRef.current = savedLabels;
  const selectedBoxesRef = useRef(selectedBoxes);
  selectedBoxesRef.current = selectedBoxes;

  const classNames = useMemo(() => {
    if (!objNamesText) return [];
    return objNamesText.trim().split(/\r?\n/);
  }, [objNamesText]);

  const manClassId = useMemo(
    () => classNames.findIndex((name) => name.trim().toLowerCase() === "man"),
    [classNames],
  );
  const chairClassId = useMemo(
    () => classNames.findIndex((name) => name.trim().toLowerCase() === "chair"),
    [classNames],
  );
  const isClassVisible = useCallback(
    (cls: number) =>
      (cls !== manClassId || showManBoxes) &&
      (cls !== chairClassId || showChairBoxes),
    [manClassId, chairClassId, showManBoxes, showChairBoxes],
  );

  useEffect(() => {
    setSelectedBoxes((selected) => {
      const visible = new Set<number>();
      selected.forEach((index) => {
        const box = labelsRef.current[index];
        if (box && isClassVisible(box.cls)) visible.add(index);
      });
      return visible.size === selected.size ? selected : visible;
    });
  }, [isClassVisible]);

  const entry = entries[currentIndex];
  const hasUnsavedChanges = useMemo(
    () => JSON.stringify(labels) !== JSON.stringify(savedLabels),
    [labels, savedLabels],
  );

  useEffect(() => {
    if (!entry) return;
    let cancelled = false;
    setLabelsLoading(true);
    setLabels([]);
    setSavedLabels([]);
    const url = URL.createObjectURL(entry.image.blob);
    setImageUrl(url);
    entry.label.blob.text().then((text) => {
      if (cancelled) return;
      const parsed = parseYoloText(text);
      setLabels(parsed);
      setSavedLabels(parsed);
      setLabelsLoading(false);
    }).catch(() => {
      if (!cancelled) setNavigationError("Could not load annotations. Reopen the editor to retry.");
    });
    setSelectedBoxes(new Set());
    setUndoSnapshot(null);
    setPendingDraw(null);
    setDrawRect(null);
    moveBoxState.current = null;
    cycleState.current = null;
    setIsMovingBox(false);
    return () => {
      cancelled = true;
      URL.revokeObjectURL(url);
    };
  }, [entry]);

  useEffect(() => {
    setTransform(RESET_TRANSFORM);
    setImageNumber(String(currentIndex + 1));
    setNavigationError("");
    setJustSaved(false);
  }, [currentIndex]);

  useEffect(() => {
    const handler = () => {
      const fs = document.fullscreenElement === fullscreenRef.current;
      setIsFullscreen(fs);
      setTransform(RESET_TRANSFORM);
    };
    document.addEventListener("fullscreenchange", handler);
    return () => document.removeEventListener("fullscreenchange", handler);
  }, []);

  const applyZoom = useCallback(
    (factor: number, dx: number, dy: number) => {
      setTransform((prev) => {
        const newZoom = Math.min(
          MAX_ZOOM,
          Math.max(MIN_ZOOM, prev.zoom * factor),
        );
        if (newZoom === prev.zoom) return prev;
        const ratio = newZoom / prev.zoom;
        return {
          zoom: newZoom,
          panX: prev.panX + dx * (1 - ratio),
          panY: prev.panY + dy * (1 - ratio),
        };
      });
    },
    [],
  );

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const handler = (e: WheelEvent) => {
      e.preventDefault();
      const stage = stageRef.current;
      if (!stage) return;
      const rect = stage.getBoundingClientRect();
      const dx = e.clientX - rect.left;
      const dy = e.clientY - rect.top;
      const factor = Math.exp(-e.deltaY * 0.0015);
      applyZoom(factor, dx, dy);
    };
    viewport.addEventListener("wheel", handler, { passive: false });
    return () => viewport.removeEventListener("wheel", handler);
  }, [applyZoom]);

  useEffect(() => {
    if (!isDragging) return;
    const handleMove = (e: MouseEvent) => {
      const drag = dragState.current;
      if (!drag) return;
      // React may process this update after mouseup clears the drag state.
      const panX = drag.panX + e.clientX - drag.startX;
      const panY = drag.panY + e.clientY - drag.startY;
      setTransform((prev) => ({
        ...prev,
        panX,
        panY,
      }));
    };
    const handleUp = () => {
      dragState.current = null;
      setIsDragging(false);
    };
    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
    return () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
    };
  }, [isDragging]);

  useEffect(() => {
    if (!isDrawing) return;
    const handleMove = (e: MouseEvent) => {
      if (!drawState.current || !stageRef.current) return;
      const rect = stageRef.current.getBoundingClientRect();
      const normX = (e.clientX - rect.left) / rect.width;
      const normY = (e.clientY - rect.top) / rect.height;
      const x = Math.min(drawState.current.startNormX, normX);
      const y = Math.min(drawState.current.startNormY, normY);
      const w = Math.abs(normX - drawState.current.startNormX);
      const h = Math.abs(normY - drawState.current.startNormY);
      setDrawRect({ x, y, w, h });
    };
    const handleUp = () => {
      if (drawState.current && drawRect && drawRect.w > 0.005 && drawRect.h > 0.005) {
        const newLine: YoloLine = {
          cls: 0,
          xCenter: drawRect.x + drawRect.w / 2,
          yCenter: drawRect.y + drawRect.h / 2,
          width: drawRect.w,
          height: drawRect.h,
        };
        setPendingDraw(newLine);
      }
      drawState.current = null;
      setDrawRect(null);
      setIsDrawing(false);
    };
    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
    return () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
    };
  }, [isDrawing, drawRect]);

  useEffect(() => {
    if (!isResizing) return;
    const handleMove = (e: MouseEvent) => {
      if (!resizeState.current || !stageRef.current) return;
      const rect = stageRef.current.getBoundingClientRect();
      const normX = (e.clientX - rect.left) / rect.width;
      const normY = (e.clientY - rect.top) / rect.height;
      const { handle, origLeft, origTop, origRight, origBottom } = resizeState.current;

      let left = origLeft;
      let top = origTop;
      let right = origRight;
      let bottom = origBottom;

      if (handle.includes("w")) left = normX;
      if (handle.includes("e")) right = normX;
      if (handle.includes("n")) top = normY;
      if (handle.includes("s")) bottom = normY;

      if (right - left < MIN_BOX_SIZE) {
        if (handle.includes("w")) left = right - MIN_BOX_SIZE;
        else right = left + MIN_BOX_SIZE;
      }
      if (bottom - top < MIN_BOX_SIZE) {
        if (handle.includes("n")) top = bottom - MIN_BOX_SIZE;
        else bottom = top + MIN_BOX_SIZE;
      }

      left = Math.max(0, Math.min(1, left));
      right = Math.max(0, Math.min(1, right));
      top = Math.max(0, Math.min(1, top));
      bottom = Math.max(0, Math.min(1, bottom));

      const idx = selectedBoxesRef.current.size === 1 ? [...selectedBoxesRef.current][0] : null;
      if (idx === null) return;

      setLabels((prev) => {
        const updated = [...prev];
        if (idx >= 0 && idx < updated.length) {
          updated[idx] = {
            ...updated[idx],
            xCenter: (left + right) / 2,
            yCenter: (top + bottom) / 2,
            width: right - left,
            height: bottom - top,
          };
        }
        return updated;
      });
    };
    const handleUp = () => {
      resizeState.current = null;
      setIsResizing(false);
    };
    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
    return () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
    };
  }, [isResizing]);

  useEffect(() => {
    if (!isMovingBox) return;
    const handleMove = (e: MouseEvent) => {
      if (!moveBoxState.current || !stageRef.current) return;
      const rect = stageRef.current.getBoundingClientRect();
      const normX = (e.clientX - rect.left) / rect.width;
      const normY = (e.clientY - rect.top) / rect.height;
      const move = moveBoxState.current;
      if (!didMoveRef.current && Math.hypot(e.clientX - move.startX, e.clientY - move.startY) < 4) return;
      didMoveRef.current = true;
      const updated = moveSelectedBoxes(move.original, move.selected,
        normX - move.startNormX, normY - move.startNormY);
      if (!move.started && updated !== move.original) {
        setUndoSnapshot(move.original);
        move.started = true;
      }
      setSelectedBoxes(move.selected);
      setLabels(updated);
    };
    const handleUp = () => {
      const move = moveBoxState.current;
      if (move && !didMoveRef.current) setSelectedBoxes(new Set([move.clickTarget]));
      moveBoxState.current = null;
      setIsMovingBox(false);
    };
    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
    return () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
    };
  }, [isMovingBox]);

  const screenToNorm = useCallback((clientX: number, clientY: number) => {
    const stage = stageRef.current;
    if (!stage) return null;
    const rect = stage.getBoundingClientRect();
    return {
      x: (clientX - rect.left) / rect.width,
      y: (clientY - rect.top) / rect.height,
    };
  }, []);

  const HIT_TOLERANCE_PX = 8;

  const hitTestBoxes = useCallback(
    (clientX: number, clientY: number): number[] => {
      const stage = stageRef.current;
      if (!stage) return [];
      const rect = stage.getBoundingClientRect();
      const results: { index: number; area: number }[] = [];

      for (let i = 0; i < labelsRef.current.length; i++) {
        const box = labelsRef.current[i];
        if (!isClassVisible(box.cls)) continue;
        const left = rect.left + (box.xCenter - box.width / 2) * rect.width;
        const right = rect.left + (box.xCenter + box.width / 2) * rect.width;
        const top = rect.top + (box.yCenter - box.height / 2) * rect.height;
        const bottom = rect.top + (box.yCenter + box.height / 2) * rect.height;
        if (
          clientX >= left - HIT_TOLERANCE_PX &&
          clientX <= right + HIT_TOLERANCE_PX &&
          clientY >= top - HIT_TOLERANCE_PX &&
          clientY <= bottom + HIT_TOLERANCE_PX
        ) {
          results.push({ index: i, area: box.width * box.height });
        }
      }

      results.sort((a, b) => a.area - b.area);
      return results.map((r) => r.index);
    },
    [isClassVisible],
  );

  const handleViewportMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0 || labelsLoading || pendingDraw || showUnsavedDialog) return;
      e.preventDefault();
      if (tool === "draw") {
        const norm = screenToNorm(e.clientX, e.clientY);
        if (!norm) return;
        drawState.current = { startNormX: norm.x, startNormY: norm.y };
        setDrawRect({ x: norm.x, y: norm.y, w: 0, h: 0 });
        setIsDrawing(true);
        return;
      }

      const norm = screenToNorm(e.clientX, e.clientY);
      if (!norm) return;

      const hits = showBoxes ? hitTestBoxes(e.clientX, e.clientY) : [];

      if (hits.length === 0) {
        dragState.current = {
          startX: e.clientX,
          startY: e.clientY,
          panX: transformRef.current.panX,
          panY: transformRef.current.panY,
        };
        setIsDragging(true);
        setSelectedBoxes(new Set());
        cycleState.current = null;
        return;
      }

      const isMultiSelect = e.ctrlKey;
      const sameSpot =
        cycleState.current &&
        Math.abs(e.clientX - cycleState.current.lastClickX) < 3 &&
        Math.abs(e.clientY - cycleState.current.lastClickY) < 3 &&
        !didMoveRef.current;

      let targetIndex: number;

      if (sameSpot && cycleState.current && cycleState.current.hitIndices.every((index, i) => index === hits[i]) && cycleState.current.hitIndices.length === hits.length) {
        const nextPos = (cycleState.current.cyclePos + 1) % hits.length;
        targetIndex = hits[nextPos];
        cycleState.current = {
          lastClickX: e.clientX,
          lastClickY: e.clientY,
          hitIndices: hits,
          cyclePos: nextPos,
        };
      } else {
        targetIndex = hits[0];
        cycleState.current = {
          lastClickX: e.clientX,
          lastClickY: e.clientY,
          hitIndices: hits,
          cyclePos: 0,
        };
      }

      didMoveRef.current = false;

      if (isMultiSelect) {
        setSelectedBoxes((prev) => {
          const next = new Set(prev);
          if (next.has(targetIndex)) next.delete(targetIndex);
          else next.add(targetIndex);
          return next;
        });
        return;
      }

      const selectedHit = hits.find((index) => selectedBoxesRef.current.has(index));
      const selection = selectedHit === undefined
        ? new Set([hits[0]]) : new Set(selectedBoxesRef.current);
      setSelectedBoxes(selection);
      moveBoxState.current = {
        startNormX: norm.x,
        startNormY: norm.y,
        startX: e.clientX,
        startY: e.clientY,
        original: labelsRef.current,
        selected: selection,
        clickTarget: targetIndex,
        started: false,
      };
      setIsMovingBox(true);
    },
    [tool, screenToNorm, hitTestBoxes, labelsLoading, pendingDraw, showUnsavedDialog, showBoxes],
  );

  const handleHandleMouseDown = useCallback(
    (e: React.MouseEvent, handle: string, box: YoloLine) => {
      if (e.button !== 0 || e.ctrlKey) return;
      if (tool !== "pan") return;
      if (selectedBoxesRef.current.size !== 1) return;
      e.stopPropagation();
      setUndoSnapshot(labelsRef.current);
      resizeState.current = {
        handle,
        origLeft: box.xCenter - box.width / 2,
        origTop: box.yCenter - box.height / 2,
        origRight: box.xCenter + box.width / 2,
        origBottom: box.yCenter + box.height / 2,
      };
      setIsResizing(true);
    },
    [tool],
  );

  const deleteSelected = useCallback(() => {
    if (selectedBoxes.size === 0) return;
    setUndoSnapshot(labelsRef.current);
    const toDelete = new Set(selectedBoxes);
    setLabels((prev) => prev.filter((_, i) => !toDelete.has(i)));
    setSelectedBoxes(new Set());
  }, [selectedBoxes]);

  const copySelected = useCallback(() => {
    const copied = [...selectedBoxes]
      .sort((a, b) => a - b)
      .map((index) => labelsRef.current[index])
      .filter((box): box is YoloLine => Boolean(box))
      .map((box) => ({ ...box }));
    if (copied.length > 0) setCopiedBoxes(copied);
  }, [selectedBoxes]);

  const pasteCopied = useCallback(() => {
    if (copiedBoxes.length === 0 || labelsLoading || pendingDraw || showUnsavedDialog) return;
    const pasted = copiedBoxes.map((box) => ({
      ...box,
      xCenter: Math.min(1 - box.width / 2, box.xCenter + 0.02),
      yCenter: Math.min(1 - box.height / 2, box.yCenter + 0.02),
    }));
    setUndoSnapshot(labelsRef.current);
    setLabels((prev) => [...prev, ...pasted]);
    setSelectedBoxes(new Set(pasted.map((_, index) => labelsRef.current.length + index)));
  }, [copiedBoxes, labelsLoading, pendingDraw, showUnsavedDialog]);

  const undo = useCallback(() => {
    if (!undoSnapshot) return;
    setLabels(undoSnapshot);
    setUndoSnapshot(null);
    setSelectedBoxes(new Set());
  }, [undoSnapshot]);

  const save = useCallback(() => {
    if (!entry || labelsLoading || isMovingBox) return;
    const text = labelsToText(labelsRef.current);
    onSave(entry.split, entry.label.name, text);
    setSavedLabels(labelsRef.current);
    setUndoSnapshot(null);
    setJustSaved(true);
    setTimeout(() => setJustSaved(false), 2000);
  }, [entry, onSave, labelsLoading, isMovingBox]);

  const confirmDraw = useCallback(
    (cls: number) => {
      if (!pendingDraw) return;
      setUndoSnapshot(labelsRef.current);
      const newLabels = [...labelsRef.current, { ...pendingDraw, cls }];
      setLabels(newLabels);
      setSelectedBoxes(new Set([newLabels.length - 1]));
      setPendingDraw(null);
    },
    [pendingDraw],
  );

  const cancelDraw = useCallback(() => {
    setPendingDraw(null);
  }, []);

  const zoomByButton = useCallback((factor: number) => {
    const viewport = viewportRef.current;
    const stage = stageRef.current;
    if (!viewport || !stage) return;
    const vRect = viewport.getBoundingClientRect();
    const sRect = stage.getBoundingClientRect();
    const dx = vRect.left + vRect.width / 2 - sRect.left;
    const dy = vRect.top + vRect.height / 2 - sRect.top;
    applyZoom(factor, dx, dy);
  }, [applyZoom]);

  const toggleFullscreen = useCallback(() => {
    if (!document.fullscreenElement) {
      fullscreenRef.current?.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  }, []);

  const handleExitFullscreen = useCallback(() => {
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    }
  }, []);

  const handleBack = useCallback(() => {
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    }
    onBack();
  }, [onBack]);

  const navigateTo = useCallback(
    (index: number) => {
      if (index < 0 || index >= entries.length || index === currentIndex || isMovingBox || isResizing || isDrawing || pendingDraw || showUnsavedDialog) return;
      if (hasUnsavedChanges) {
        setShowUnsavedDialog(true);
        setPendingNavigate(index);
      } else {
        setCurrentIndex(index);
      }
    },
    [entries.length, hasUnsavedChanges, currentIndex, isMovingBox, isResizing, isDrawing, pendingDraw, showUnsavedDialog],
  );

  const goPrev = useCallback(() => navigateTo(currentIndex - 1), [currentIndex, navigateTo]);
  const goNext = useCallback(() => navigateTo(currentIndex + 1), [currentIndex, navigateTo]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return;
      if (isResizing || isMovingBox) return;

      if ((e.ctrlKey || e.metaKey) && (e.key === "a" || e.key === "A")) {
        e.preventDefault();
        goPrev();
      } else if (e.shiftKey && (e.key === "c" || e.key === "C")) {
        if (selectedBoxesRef.current.size === 0) return;
        e.preventDefault();
        copySelected();
      } else if (e.shiftKey && (e.key === "v" || e.key === "V")) {
        if (copiedBoxes.length === 0) return;
        e.preventDefault();
        pasteCopied();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        goPrev();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        goNext();
      } else if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        deleteSelected();
      } else if (e.key === "v" || e.key === "V") {
        e.preventDefault();
        setShowBoxes((v) => !v);
      } else if ((e.key === "d" || e.key === "D") && !pendingDraw && !showUnsavedDialog) {
        e.preventDefault();
        setTool((prev) => (prev === "pan" ? "draw" : "pan"));
      } else if (e.key === "f" || e.key === "F") {
        e.preventDefault();
        toggleFullscreen();
      } else if ((e.ctrlKey || e.metaKey) && e.key === "z") {
        e.preventDefault();
        undo();
      } else if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        save();
      } else if (e.key === "Escape") {
        if (pendingDraw) {
          setPendingDraw(null);
        } else if (document.fullscreenElement) {
          document.exitFullscreen().catch(() => {});
        } else if (!isDrawing && !isDragging) {
          onBack();
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [goPrev, goNext, copySelected, pasteCopied, copiedBoxes.length, deleteSelected, undo, save, toggleFullscreen, onBack, pendingDraw, isDrawing, isDragging, showUnsavedDialog, isResizing, isMovingBox]);

  if (entries.length === 0) {
    return (
      <div className="max-w-2xl mx-auto">
        <div className="bg-white border border-slate-200 rounded-2xl p-8 text-center shadow-sm">
          <p className="text-sm text-slate-500">No tile images found.</p>
          <button
            onClick={onBack}
            className="mt-4 text-sm text-slate-500 hover:text-slate-700"
          >
            Back
          </button>
        </div>
      </div>
    );
  }

  const viewportCursor =
    tool === "draw"
      ? "cursor-crosshair"
      : isDragging || isMovingBox
        ? "cursor-grabbing"
        : "cursor-grab";

  const handleSize = `${HANDLE_PX / transform.zoom}px`;

  return (
    <div className="max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-xl font-bold text-slate-800">Annotation Editor</h2>
          <p className="text-sm text-slate-500 mt-1">
            Click a box to select (smallest box wins on overlap, click again to
            cycle), Ctrl+click to select or deselect multiple boxes. Release
            Ctrl and drag a selected box to move the group. Drag handles to
            resize, Del to delete, Shift+C/Shift+V to copy and paste selected boxes,
            Ctrl+A for the previous image, D for draw mode, Ctrl+S to save. Scroll to zoom,
            drag to pan.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={onFinalize}
            className="px-4 py-2 rounded-xl bg-green-600 text-white font-semibold text-sm hover:bg-green-700 transition-colors inline-flex items-center gap-2"
          >
            <CheckCircle2 className="w-4 h-4" />
            Finalize
          </button>
          <button
            onClick={handleBack}
            className="text-sm text-slate-500 hover:text-slate-700 flex items-center gap-1.5 px-3 py-2 rounded-lg hover:bg-slate-100 transition-colors"
          >
            <X className="w-4 h-4" />
            Back
          </button>
        </div>
      </div>

      <div
        ref={fullscreenRef}
        className={
          isFullscreen
            ? "bg-slate-900 flex flex-col h-screen"
            : "bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm"
        }
      >
        {/* Toolbar */}
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-100 bg-slate-50 flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-slate-600">
              {currentIndex + 1} / {entries.length}
            </span>
            <form className="flex items-center gap-2 flex-wrap" onSubmit={(event) => {
              event.preventDefault();
              const index = imageNumberToIndex(imageNumber, entries.length);
              if (index === null) {
                setNavigationError(`Enter a whole image number from 1 to ${entries.length}.`);
                return;
              }
              setNavigationError("");
              setImageNumber(String(currentIndex + 1));
              navigateTo(index);
            }}>
              <label htmlFor="editor-image-number" className="text-xs text-slate-600">Image number</label>
              <input id="editor-image-number" type="text" inputMode="numeric"
                value={imageNumber} onChange={(event) => {
                  setImageNumber(event.target.value);
                  setNavigationError("");
                }}
                aria-invalid={Boolean(navigationError)}
                aria-describedby={navigationError ? "editor-navigation-error" : undefined}
                className="w-20 rounded border border-slate-300 px-2 py-1 text-sm"
              />
              <button type="submit" disabled={isMovingBox || isResizing || isDrawing || Boolean(pendingDraw) || showUnsavedDialog}
                className="rounded bg-slate-200 px-2 py-1 text-sm hover:bg-slate-300 disabled:opacity-40">Go</button>
              {navigationError && <span id="editor-navigation-error" role="alert" className="text-xs text-red-600">{navigationError}</span>}
            </form>
            <span
              className={`text-xs px-2 py-0.5 rounded-full font-medium flex items-center gap-1 ${
                entry.split === "train"
                  ? "bg-blue-100 text-blue-700"
                  : "bg-amber-100 text-amber-700"
              }`}
            >
              {entry.split === "train" ? (
                <Train className="w-3 h-3" />
              ) : (
                <TestTube className="w-3 h-3" />
              )}
              {entry.split === "train" ? "Train" : "Valid"}
            </span>
            {justSaved ? (
              <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700 font-medium flex items-center gap-1">
                <Check className="w-3 h-3" />
                Saved
              </span>
            ) : hasUnsavedChanges ? (
              <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 font-medium flex items-center gap-1">
                <AlertCircle className="w-3 h-3" />
                Unsaved
              </span>
            ) : (
              <span className="text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 font-medium">
                No changes
              </span>
            )}
          </div>

          <div className="flex items-center gap-1">
            <button
              onClick={() => setTool(tool === "pan" ? "draw" : "pan")}
              className={`p-1.5 rounded-lg transition-colors cursor-pointer ${tool === "draw" ? "bg-blue-200 text-blue-700" : "text-slate-500 hover:bg-slate-100"}`}
              title="Draw mode (D)"
            >
              {tool === "draw" ? <Pencil className="w-4 h-4" /> : <MousePointerClick className="w-4 h-4" />}
            </button>

            <div className="w-px h-5 bg-slate-200 mx-0.5" />

            <button
              onClick={deleteSelected}
              disabled={selectedBoxes.size === 0}
              className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-600 disabled:opacity-30 disabled:hover:bg-transparent cursor-pointer"
              title="Delete selected (Del)"
            >
              <Trash2 className="w-4 h-4" />
            </button>
            <button
              onClick={copySelected}
              disabled={selectedBoxes.size === 0}
              className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-600 disabled:opacity-30 disabled:hover:bg-transparent cursor-pointer"
              title="Copy selected box(es) (Shift+C)"
            >
              <Copy className="w-4 h-4" />
            </button>
            <button
              onClick={pasteCopied}
              disabled={copiedBoxes.length === 0}
              className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-600 disabled:opacity-30 disabled:hover:bg-transparent cursor-pointer"
              title="Paste copied box(es) (Shift+V)"
            >
              <ClipboardPaste className="w-4 h-4" />
            </button>
            <button
              onClick={undo}
              disabled={!undoSnapshot}
              className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-600 disabled:opacity-30 disabled:hover:bg-transparent cursor-pointer"
              title="Undo (Ctrl+Z)"
            >
              <Undo2 className="w-4 h-4" />
            </button>
            <button
              onClick={save}
              disabled={!hasUnsavedChanges}
              className={`p-1.5 rounded-lg transition-colors cursor-pointer ${hasUnsavedChanges ? "bg-green-100 text-green-700 hover:bg-green-200" : "text-slate-400 opacity-50"}`}
              title="Save (Ctrl+S)"
            >
              <Save className="w-4 h-4" />
            </button>

            <div className="w-px h-5 bg-slate-200 mx-0.5" />

            <button
              onClick={() => setShowBoxes((v) => !v)}
              className={`p-1.5 rounded-lg transition-colors cursor-pointer ${showBoxes ? "bg-slate-200 text-slate-700" : "text-slate-500 hover:bg-slate-100"}`}
              title="Toggle visibility (V)"
              aria-label="Toggle visibility of all boxes"
              aria-pressed={showBoxes}
            >
              {showBoxes ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
            </button>
            {manClassId >= 0 && (
              <button
                onClick={() => setShowManBoxes((visible) => !visible)}
                className={`p-1.5 rounded-lg transition-colors cursor-pointer flex items-center gap-1 text-xs font-medium ${showManBoxes ? "bg-slate-200 text-slate-700" : "text-slate-500 hover:bg-slate-100"}`}
                title={`${showManBoxes ? "Hide" : "Show"} Man boxes`}
                aria-label={`${showManBoxes ? "Hide" : "Show"} Man boxes`}
                aria-pressed={showManBoxes}
              >
                {showManBoxes ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                Man
              </button>
            )}
            {chairClassId >= 0 && (
              <button
                onClick={() => setShowChairBoxes((visible) => !visible)}
                className={`p-1.5 rounded-lg transition-colors cursor-pointer flex items-center gap-1 text-xs font-medium ${showChairBoxes ? "bg-slate-200 text-slate-700" : "text-slate-500 hover:bg-slate-100"}`}
                title={`${showChairBoxes ? "Hide" : "Show"} Chair boxes`}
                aria-label={`${showChairBoxes ? "Hide" : "Show"} Chair boxes`}
                aria-pressed={showChairBoxes}
              >
                {showChairBoxes ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                Chair
              </button>
            )}
            <button
              onClick={() => setShowClassNames((v) => !v)}
              className={`p-1.5 rounded-lg transition-colors cursor-pointer ${showClassNames ? "bg-slate-200 text-slate-700" : "text-slate-500 hover:bg-slate-100"}`}
              title="Toggle class names"
            >
              <Tag className="w-4 h-4" />
            </button>

            <div className="w-px h-5 bg-slate-200 mx-0.5" />

            <button
              onClick={() => zoomByButton(1 / 1.25)}
              className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-600 cursor-pointer"
              title="Zoom out"
            >
              <ZoomOut className="w-4 h-4" />
            </button>
            <span className="text-xs text-slate-500 font-medium w-10 text-center tabular-nums">
              {Math.round(transform.zoom * 100)}%
            </span>
            <button
              onClick={() => zoomByButton(1.25)}
              className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-600 cursor-pointer"
              title="Zoom in"
            >
              <ZoomIn className="w-4 h-4" />
            </button>

            <div className="w-px h-5 bg-slate-200 mx-0.5" />

            <button
              onClick={toggleFullscreen}
              className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-600 cursor-pointer"
              title={isFullscreen ? "Exit fullscreen (F)" : "Fullscreen (F)"}
            >
              {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
            </button>

            <div className="w-px h-5 bg-slate-200 mx-0.5" />

            <button
              onClick={goPrev}
              disabled={currentIndex === 0}
              className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-600 disabled:opacity-30 disabled:hover:bg-transparent cursor-pointer"
              title="Previous"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
            <button
              onClick={goNext}
              disabled={currentIndex === entries.length - 1}
              className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-600 disabled:opacity-30 disabled:hover:bg-transparent cursor-pointer"
              title="Next"
            >
              <ChevronRight className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Viewport */}
        <div
          ref={viewportRef}
          onMouseDown={handleViewportMouseDown}
          onDragStart={(e) => e.preventDefault()}
          className={`relative bg-slate-900 overflow-hidden flex items-center justify-center select-none ${viewportCursor} ${isFullscreen ? "flex-1" : "h-[65vh]"}`}
        >
          {imageUrl ? (
            <div
              ref={stageRef}
              className="relative inline-block will-change-transform"
              style={{
                transform: `translate(${transform.panX}px, ${transform.panY}px) scale(${transform.zoom})`,
                transformOrigin: "0 0",
              }}
            >
              <img
                ref={imgRef}
                src={imageUrl}
                alt={entry.image.name}
                className="block object-contain"
                style={{
                  maxWidth: "100%",
                  maxHeight: isFullscreen ? "calc(100vh - 50px)" : "65vh",
                }}
                draggable={false}
              />
              {showBoxes && [
                ...labels.map((line, i) => ({ line, i, isSelected: selectedBoxes.has(i) }))
                  .filter((b) => !b.isSelected && isClassVisible(b.line.cls))
                  .map(({ line, i }) => {
                    const color = getClassColor(line.cls);
                    const leftPct = (line.xCenter - line.width / 2) * 100;
                    const topPct = (line.yCenter - line.height / 2) * 100;
                    return (
                      <div
                        key={i}
                        className="absolute rounded-sm"
                        style={{
                          left: `${leftPct}%`,
                          top: `${topPct}%`,
                          width: `${line.width * 100}%`,
                          height: `${line.height * 100}%`,
                          border: `2px solid ${color}`,
                          boxShadow: `0 0 0 1px rgba(0,0,0,0.3)`,
                          cursor: tool === "pan" ? "move" : "crosshair",
                          pointerEvents: "none",
                          zIndex: 1,
                        }}
                      >
                        {showClassNames && (
                          <span
                            className="absolute -top-5 left-0 text-xs font-bold px-1 py-0.5 rounded whitespace-nowrap pointer-events-none"
                            style={{
                              backgroundColor: color,
                              color: "#fff",
                            }}
                          >
                            {classNames[line.cls] ?? `cls ${line.cls}`}
                          </span>
                        )}
                      </div>
                    );
                  }),
                ...labels.map((line, i) => ({ line, i, isSelected: selectedBoxes.has(i) }))
                  .filter((b) => b.isSelected && isClassVisible(b.line.cls))
                  .map(({ line, i }) => {
                    const color = getClassColor(line.cls);
                    const leftPct = (line.xCenter - line.width / 2) * 100;
                    const topPct = (line.yCenter - line.height / 2) * 100;
                    return (
                      <div
                        key={i}
                        className="absolute rounded-sm"
                        style={{
                          left: `${leftPct}%`,
                          top: `${topPct}%`,
                          width: `${line.width * 100}%`,
                          height: `${line.height * 100}%`,
                          border: `1px solid ${color}`,
                          boxShadow: `0 0 0 1px #ffffff, 0 0 0 2px rgba(0,0,0,0.5)`,
                          cursor: tool === "pan" ? "move" : "crosshair",
                          pointerEvents: "none",
                          zIndex: 20,
                        }}
                      >
                        {showClassNames && (
                          <span
                            className="absolute -top-5 left-0 text-xs font-bold px-1 py-0.5 rounded whitespace-nowrap pointer-events-none"
                            style={{
                              backgroundColor: color,
                              color: "#fff",
                            }}
                          >
                            {classNames[line.cls] ?? `cls ${line.cls}`}
                          </span>
                        )}
                        {selectedBoxes.size === 1 && tool === "pan" &&
                          HANDLES.map((h) => (
                            <div
                              key={h.id}
                              onMouseDown={(e) =>
                                handleHandleMouseDown(e, h.id, line)
                              }
                              className="absolute bg-white rounded-sm"
                              style={{
                                left: h.left,
                                top: h.top,
                                width: handleSize,
                                height: handleSize,
                                transform: "translate(-50%, -50%)",
                                border: `${Math.max(1, 1.5 / transform.zoom)}px solid ${color}`,
                                cursor: h.cursor,
                                pointerEvents: "auto",
                              }}
                            />
                          ))}
                      </div>
                    );
                  }),
              ]}
              {drawRect && (
                <div
                  className="absolute border-2 border-white border-dashed pointer-events-none"
                  style={{
                    left: `${drawRect.x * 100}%`,
                    top: `${drawRect.y * 100}%`,
                    width: `${drawRect.w * 100}%`,
                    height: `${drawRect.h * 100}%`,
                    boxShadow: "0 0 0 1px rgba(0,0,0,0.5)",
                  }}
                />
              )}
            </div>
          ) : (
            <div className="text-slate-500 text-sm py-20">Loading image...</div>
          )}

          {isFullscreen && (
            <button
              onClick={handleExitFullscreen}
              onMouseDown={(e) => e.stopPropagation()}
              className="absolute top-4 right-4 z-10 px-3 py-2 rounded-lg bg-white/90 text-slate-700 text-sm font-medium flex items-center gap-1.5 shadow-lg hover:bg-white transition-colors cursor-pointer"
            >
              <Minimize2 className="w-4 h-4" />
              Exit Fullscreen
            </button>
          )}

          <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-slate-900/80 to-transparent px-4 py-3 pointer-events-none">
            <p className="text-white text-sm font-medium truncate">
              {entry.image.name}
            </p>
            <p className="text-slate-300 text-xs">
              {labels.length} annotation{labels.length === 1 ? "" : "s"}
              {selectedBoxes.size > 0 && ` - ${selectedBoxes.size} box${selectedBoxes.size === 1 ? "" : "es"} selected`}
            </p>
          </div>
        </div>

        {/* Class picker modal for drawn box */}
        {pendingDraw && (
          <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/50">
            <div className="bg-white rounded-2xl shadow-xl p-6 max-w-sm w-full mx-4">
              <h3 className="text-base font-bold text-slate-800 mb-1">
                Assign a class
              </h3>
              <p className="text-sm text-slate-500 mb-4">
                Choose the class for this new annotation box.
              </p>
              <div className="max-h-60 overflow-y-auto space-y-1">
                {classNames.length > 0 ? (
                  classNames.map((name, cls) => (
                    <button
                      key={cls}
                      onClick={() => confirmDraw(cls)}
                      className="w-full flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-slate-100 transition-colors text-left cursor-pointer"
                    >
                      <span
                        className="w-3 h-3 rounded-sm flex-shrink-0"
                        style={{ backgroundColor: getClassColor(cls) }}
                      />
                      <span className="text-sm text-slate-700">{name}</span>
                      <span className="text-xs text-slate-400 ml-auto">
                        cls {cls}
                      </span>
                    </button>
                  ))
                ) : (
                  <button
                    onClick={() => confirmDraw(0)}
                    className="w-full flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-slate-100 transition-colors text-left cursor-pointer"
                  >
                    <span
                      className="w-3 h-3 rounded-sm flex-shrink-0"
                      style={{ backgroundColor: getClassColor(0) }}
                    />
                    <span className="text-sm text-slate-700">Class 0</span>
                  </button>
                )}
              </div>
              <button
                onClick={cancelDraw}
                className="mt-4 w-full px-4 py-2 rounded-lg text-sm text-slate-500 hover:bg-slate-100 transition-colors cursor-pointer"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Unsaved changes dialog */}
        {showUnsavedDialog && pendingNavigate !== null && (
          <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/50">
            <div className="bg-white rounded-2xl shadow-xl p-6 max-w-sm w-full mx-4">
              <div className="flex items-start gap-3 mb-4">
                <div className="w-10 h-10 rounded-full bg-amber-50 flex items-center justify-center flex-shrink-0">
                  <AlertCircle className="w-5 h-5 text-amber-600" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-800">
                    Unsaved changes
                  </h3>
                  <p className="text-sm text-slate-500 mt-1">
                    You have unsaved annotation changes for{" "}
                    <span className="font-medium">{entry.image.name}</span>.
                    Save before navigating, or discard the changes.
                  </p>
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    save();
                    setShowUnsavedDialog(false);
                    if (pendingNavigate !== null) {
                      setCurrentIndex(pendingNavigate);
                      setPendingNavigate(null);
                    }
                  }}
                  className="flex-1 px-4 py-2 rounded-lg bg-green-600 text-white text-sm font-medium hover:bg-green-700 transition-colors cursor-pointer"
                >
                  Save & continue
                </button>
                <button
                  onClick={() => {
                    setShowUnsavedDialog(false);
                    if (pendingNavigate !== null) {
                      setCurrentIndex(pendingNavigate);
                      setPendingNavigate(null);
                    }
                  }}
                  className="flex-1 px-4 py-2 rounded-lg bg-slate-100 text-slate-600 text-sm font-medium hover:bg-slate-200 transition-colors cursor-pointer"
                >
                  Discard
                </button>
                <button
                  onClick={() => {
                    setShowUnsavedDialog(false);
                    setPendingNavigate(null);
                  }}
                  className="px-4 py-2 rounded-lg text-slate-500 text-sm hover:bg-slate-100 transition-colors cursor-pointer"
                >
                  Stay
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Dot strip */}
      <div className="mt-4 bg-white border border-slate-200 rounded-xl p-3 max-h-28 overflow-y-auto">
        <div className="flex flex-wrap gap-1">
          {entries.map((e, i) => (
            <button
              key={e.image.name}
              onClick={() => navigateTo(i)}
              title={e.image.name}
              className={`w-2.5 h-2.5 rounded-full transition-all cursor-pointer ${
                i === currentIndex
                  ? "ring-2 ring-slate-900 ring-offset-1 scale-125"
                  : ""
              } ${e.split === "train" ? "bg-blue-500" : "bg-amber-400"}`}
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

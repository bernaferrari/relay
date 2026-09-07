/** @jsxImportSource react */
import type { TalkBackReview, TalkBackReviewItem } from "@relay/protocol";
import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { SelectField } from "../components/filter-select";
import type { Platform } from "../platform/types";
import {
  ACCESSIBILITY_LABELS_STORAGE_KEY,
  ACCESSIBILITY_LABEL_MODE_OPTIONS,
  accessibilityObservationId,
  currentAccessibilityInspection,
  retainAccessibilityObservation,
  talkBackItemAtPoint,
  talkBackOverlayBox,
  validAccessibilityLabelMode,
  visibleTalkBackOverlayItems,
  type AccessibilityInspection,
  type AccessibilityLabelMode,
  type TalkBackCaptureResult,
} from "../data/talkback-overlay";

export { currentAccessibilityInspection, visibleTalkBackOverlayItems };
export type { AccessibilityInspection };

export type { TalkBackCaptureResult, AccessibilityLabelMode };

const MODE_OPTIONS = ACCESSIBILITY_LABEL_MODE_OPTIONS.map((option) => ({
  value: option.value,
  label: option.label,
}));

export function TalkBackModeSelect({
  mode,
  loading,
  disabled,
  onModeChange,
}: {
  mode: AccessibilityLabelMode;
  loading: boolean;
  disabled?: boolean;
  onModeChange: (mode: AccessibilityLabelMode) => void;
}) {
  return (
    <SelectField
      compact
      label={loading ? "Reading labels" : "Accessibility names"}
      value={mode}
      options={MODE_OPTIONS}
      onValueChange={(value) => onModeChange(validAccessibilityLabelMode(value))}
      className={disabled ? "pointer-events-none opacity-60" : "min-w-[9.5rem]"}
    />
  );
}

export function TalkBackOverlay({
  canvasRef,
  items,
  mode,
}: {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  items: readonly TalkBackReviewItem[];
  mode: Exclude<AccessibilityLabelMode, "off">;
}) {
  const [boxes, setBoxes] = useState<
    Array<{
      item: TalkBackReviewItem;
      box: { left: number; top: number; width: number; height: number };
    }>
  >([]);
  const [hoveredId, setHoveredId] = useState<string>();

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    const parent = canvas?.parentElement;
    if (!canvas || !parent) {
      setBoxes([]);
      return;
    }
    const mapBoxes = () => {
      const mapped = items.flatMap((item) => {
        if (!item.rect) return [];
        const box = talkBackOverlayBox(canvas, parent, item.rect);
        return box ? [{ item, box }] : [];
      });
      setBoxes(mapped);
    };
    mapBoxes();
    const observer =
      typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(mapBoxes);
    observer?.observe(canvas);
    observer?.observe(parent);
    return () => observer?.disconnect();
  }, [canvasRef, items]);

  useEffect(() => {
    if (mode !== "hover") {
      setHoveredId(undefined);
      return;
    }
    const canvas = canvasRef.current;
    const parent = canvas?.parentElement;
    if (!canvas || !parent) return;
    const move = (event: PointerEvent) => {
      const frame = parent.getBoundingClientRect();
      const hit = talkBackItemAtPoint(boxes, {
        x: event.clientX - frame.left,
        y: event.clientY - frame.top,
      });
      setHoveredId(hit?.item.id);
    };
    const leave = () => setHoveredId(undefined);
    canvas.addEventListener("pointermove", move);
    canvas.addEventListener("pointerleave", leave);
    return () => {
      canvas.removeEventListener("pointermove", move);
      canvas.removeEventListener("pointerleave", leave);
    };
  }, [boxes, canvasRef, mode]);

  const visible = mode === "always" ? boxes : boxes.filter((entry) => entry.item.id === hoveredId);
  if (!visible.length && mode === "always") return null;
  return (
    <div className="pointer-events-none absolute inset-0 z-10 overflow-hidden" aria-hidden="true">
      {visible.map(({ item, box }) => {
        const problem = item.issues.some((issue) => issue.severity === "error");
        return (
          <span
            key={item.id}
            className={`absolute max-w-[46%] truncate rounded-sm px-1 py-0.5 text-[10px] font-medium leading-tight shadow-sm ${
              problem
                ? "bg-destructive text-destructive-foreground"
                : "bg-background/90 text-foreground"
            }`}
            style={{
              left: box.left,
              top: Math.max(0, box.top - 18),
              maxWidth: Math.max(72, box.width),
            }}
          >
            {item.announcement || "Unnamed"}
          </span>
        );
      })}
    </div>
  );
}

export function TalkBackIssueList({
  review,
  inspectable,
  message,
}: {
  review?: TalkBackReview;
  inspectable?: boolean;
  message?: string;
}) {
  if (!review) {
    return message ? <p className="text-xs text-muted-foreground">{message}</p> : null;
  }
  if (inspectable === false) {
    return (
      <p className="text-xs text-muted-foreground">
        {message ?? "Accessibility names are unavailable. The live view still works."}
      </p>
    );
  }
  if (!review.issues.length) {
    return (
      <p className="text-xs text-muted-foreground">
        {review.items.length
          ? `${review.items.length} accessibility names on this screen.`
          : "No accessibility names are available for this observation."}
      </p>
    );
  }
  return (
    <div className="grid gap-2">
      <p className="text-xs text-muted-foreground">
        {review.errorCount
          ? `${review.errorCount} unlabeled ${review.errorCount === 1 ? "control" : "controls"}`
          : "Accessibility names"}
        {review.warningCount ? ` · ${review.warningCount} warnings` : ""}. These are captured names
        from the accessibility tree, not a TalkBack or VoiceOver proof.
      </p>
      <ul className="grid max-h-40 list-none gap-1 overflow-auto p-0" aria-label="TalkBack issues">
        {review.issues.map((item) => (
          <li key={item.id} className="rounded-md bg-muted/60 px-2 py-1.5 text-xs leading-snug">
            <strong className="font-medium">{item.announcement || "Unnamed"}</strong>
            <span className="block text-muted-foreground">
              {item.issues.map((issue) => issue.detail).join(" ")}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function useTalkBackReview(input: {
  enabled: boolean;
  serial?: string;
  capture?: (serial: string) => Promise<TalkBackCaptureResult>;
  refreshKey?: number;
  platform?: Platform;
}) {
  const [mode, setStoredMode] = useState<AccessibilityLabelMode>("off");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<TalkBackCaptureResult>();
  const [issue, setIssue] = useState<string>();
  const capture = useRef(input.capture);
  capture.current = input.capture;
  const on = mode !== "off";

  useEffect(() => {
    if (!input.platform) return;
    let active = true;
    void Promise.resolve(input.platform.storage.get(ACCESSIBILITY_LABELS_STORAGE_KEY))
      .then((stored) => {
        if (active) setStoredMode(validAccessibilityLabelMode(stored));
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [input.platform]);

  useEffect(() => {
    if (!on || !input.enabled || !input.serial || !capture.current) {
      setResult(undefined);
      return;
    }
    const epoch = accessibilityObservationId({
      targetId: input.serial,
      refreshKey: input.refreshKey,
    });
    let cancelled = false;
    setLoading(true);
    setIssue(undefined);
    setResult((previous) =>
      previous && previous.observationId !== epoch ? { ...previous, stale: true } : previous,
    );
    void capture
      .current(input.serial)
      .then((next) => {
        if (cancelled) return;
        setResult((previous) =>
          retainAccessibilityObservation({
            currentId: epoch,
            incomingId: epoch,
            previous,
            next: { ...next, targetId: input.serial, observationId: epoch },
          }),
        );
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setResult((previous) => (previous ? { ...previous, stale: true } : undefined));
        setIssue(
          error instanceof Error ? error.message : "Relay could not read accessibility names.",
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [on, input.enabled, input.serial, input.refreshKey]);

  const epoch = accessibilityObservationId({
    targetId: input.serial,
    refreshKey: input.refreshKey,
  });
  const inspection = currentAccessibilityInspection(on && input.serial ? result : undefined, epoch);

  return {
    mode,
    on,
    loading,
    inspection,
    issue,
    setMode(next: AccessibilityLabelMode) {
      setStoredMode(next);
      if (input.platform) {
        void Promise.resolve(input.platform.storage.set(ACCESSIBILITY_LABELS_STORAGE_KEY, next));
      }
    },
  };
}

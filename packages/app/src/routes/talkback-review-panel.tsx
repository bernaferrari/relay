/** @jsxImportSource react */
import type { TalkBackReview, TalkBackReviewItem } from "@relay/protocol";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type RefObject,
} from "react";
import { Scan, LoaderCircle } from "lucide-react";
import { Button } from "@relay/ui-react/components/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from "@relay/ui-react/components/dropdown-menu";
import type { Platform } from "../platform/types";
import {
  ACCESSIBILITY_LABELS_STORAGE_KEY,
  accessibilityObservationId,
  currentAccessibilityInspection,
  distinctTalkBackOverlays,
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
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="ghost" size="icon-sm" />}
        disabled={disabled}
        aria-label="Inspect elements"
        title={`Inspect elements · ${mode === "hover" ? "Show on hover" : mode === "always" ? "Show all with labels" : "Never show"}`}
      >
        {loading ? (
          <LoaderCircle
            className="size-4 animate-spin motion-reduce:animate-none"
            aria-hidden="true"
          />
        ) : (
          <Scan className="size-4" aria-hidden="true" />
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-56">
        <DropdownMenuRadioGroup
          value={mode}
          onValueChange={(value) => onModeChange(validAccessibilityLabelMode(value))}
        >
          {(
            [
              ["hover", "Show on hover"],
              ["always", "Show all with labels"],
              ["off", "Never show"],
            ] as const
          ).map(([value, label]) => (
            <DropdownMenuRadioItem key={value} value={value}>
              {label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function TalkBackOverlay({
  canvasRef,
  items,
  bounds,
  mode,
}: {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  items: readonly TalkBackReviewItem[];
  bounds?: { width: number; height: number };
  mode: Exclude<AccessibilityLabelMode, "off">;
}) {
  const [boxes, setBoxes] = useState<
    Array<{
      key: string;
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
      const mapped = distinctTalkBackOverlays(items).flatMap(({ key, item }) => {
        if (!item.rect) return [];
        const box = talkBackOverlayBox(canvas, parent, item.rect, bounds);
        return box ? [{ key, item, box }] : [];
      });
      setBoxes(mapped);
    };
    mapBoxes();
    const observer =
      typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(mapBoxes);
    observer?.observe(canvas);
    observer?.observe(parent);
    return () => observer?.disconnect();
  }, [canvasRef, items, bounds]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const parent = canvas?.parentElement;
    if (!canvas || !parent) return;
    const move = (event: PointerEvent) => {
      const frame = parent.getBoundingClientRect();
      const hit = talkBackItemAtPoint(boxes, {
        x: event.clientX - frame.left + parent.scrollLeft,
        y: event.clientY - frame.top + parent.scrollTop,
      });
      setHoveredId(hit?.key);
    };
    const leave = () => setHoveredId(undefined);
    parent.addEventListener("scroll", leave);
    canvas.addEventListener("pointermove", move);
    canvas.addEventListener("pointerleave", leave);
    return () => {
      parent.removeEventListener("scroll", leave);
      canvas.removeEventListener("pointermove", move);
      canvas.removeEventListener("pointerleave", leave);
    };
  }, [boxes, canvasRef, mode]);

  const visible = mode === "always" ? boxes : boxes.filter((entry) => entry.key === hoveredId);
  if (!visible.length && mode === "always") return null;
  return (
    <div className="pointer-events-none absolute inset-0 z-10 overflow-visible" aria-hidden="true">
      {visible.map(({ key, item, box }) => (
        <div
          key={key}
          className={`absolute left-(--box-left) top-(--box-top) h-(--box-height) w-(--box-width) rounded-sm border border-info/50 ${key === hoveredId ? "border-info bg-info/15 ring-1 ring-info" : "bg-info/5"}`}
          style={
            {
              "--box-left": `${box.left}px`,
              "--box-top": `${box.top}px`,
              "--box-width": `${box.width}px`,
              "--box-height": `${box.height}px`,
            } as CSSProperties
          }
        >
          {mode === "always" || key === hoveredId ? (
            <span className="absolute start-0 top-0 flex max-w-64 -translate-y-full items-center gap-1.5 whitespace-nowrap rounded-md bg-popover px-2 py-1 text-xs font-medium text-popover-foreground shadow-md ring-1 ring-border">
              <span className="truncate">
                {item.name || item.text || item.description || "No label"}
              </span>
              {item.role ? (
                <code className="shrink-0 rounded bg-muted px-1 py-0.5 text-xs font-normal text-muted-foreground">
                  {item.role}
                </code>
              ) : null}
            </span>
          ) : null}
        </div>
      ))}
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
      <ul
        className="grid max-h-40 list-none gap-1 overflow-auto p-0"
        aria-label="Accessibility names"
      >
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
  const [mode, setStoredMode] = useState<AccessibilityLabelMode>("hover");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<TalkBackCaptureResult>();
  const [issue, setIssue] = useState<string>();
  const [selectionRevision, setSelectionRevision] = useState(0);
  const capture = useRef(input.capture);
  capture.current = input.capture;
  const on = mode !== "off";

  useEffect(() => {
    if (!input.platform) return;
    let active = true;
    void Promise.resolve(input.platform.storage.get(ACCESSIBILITY_LABELS_STORAGE_KEY))
      .then((stored) => {
        if (active) setStoredMode(stored == null ? "hover" : validAccessibilityLabelMode(stored));
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [input.platform]);

  useEffect(() => {
    if (!on || !input.enabled || !input.serial || !capture.current) {
      setResult(undefined);
      setLoading(false);
      setIssue(undefined);
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
  }, [on, input.enabled, input.serial, input.refreshKey, selectionRevision]);

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
      if (next !== "off") setSelectionRevision((value) => value + 1);
      if (input.platform) {
        void Promise.resolve(input.platform.storage.set(ACCESSIBILITY_LABELS_STORAGE_KEY, next));
      }
    },
  };
}

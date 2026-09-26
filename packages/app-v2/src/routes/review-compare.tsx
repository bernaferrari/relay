/** @jsxImportSource react */
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@relay/ui-react/components/button";
import { X } from "lucide-react";
import type { CaptureReferenceRegion, CaptureReviewItem } from "@relay/protocol";
import { reviewQueryKeys, type ReviewProductService } from "../data/review-product-service";

export type CompareMode = "side" | "diff" | "swipe";

function useBlobUrl(blob: Blob | undefined): string | undefined {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    if (!blob) {
      setUrl(undefined);
      return;
    }
    const next = URL.createObjectURL(blob);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [blob]);
  return url;
}

function useReviewImage(
  service: ReviewProductService,
  kind: "capture" | "reference" | "diff",
  runId: string,
  item: CaptureReviewItem,
  enabled = true,
) {
  const query = useQuery({
    queryKey: reviewQueryKeys.image(kind, runId, item),
    queryFn: ({ signal }) =>
      kind === "capture"
        ? service.captureImage(runId, item, signal)
        : kind === "reference"
          ? service.referenceImage(runId, item, signal)
          : service.diffImage(runId, item, signal),
    enabled,
    staleTime: Infinity,
    retry: 1,
  });
  return { url: useBlobUrl(query.data), query };
}

function Shot({
  url,
  label,
  detail,
  loading,
  failed,
  children,
}: {
  url?: string;
  label: string;
  detail?: string;
  loading?: boolean;
  failed?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <figure className="grid min-w-0 content-start gap-2">
      <figcaption className="flex min-w-0 items-baseline gap-2 text-xs">
        <span className="font-medium text-foreground">{label}</span>
        {detail ? <span className="truncate text-muted-foreground">{detail}</span> : null}
      </figcaption>
      <div className="flex min-h-48 items-start justify-center rounded-lg bg-muted/30 p-2">
        {url ? (
          <div className="relative inline-block max-w-full">
            <img
              src={url}
              alt={label}
              draggable={false}
              className="block max-h-[min(68vh,52rem)] max-w-full rounded-md object-contain select-none"
            />
            {children}
          </div>
        ) : (
          <p className="self-center text-sm text-muted-foreground" role="status">
            {failed ? "Screenshot couldn’t load." : loading ? "Loading screenshot…" : ""}
          </p>
        )}
      </div>
    </figure>
  );
}

function RegionBoxes({
  regions,
  tone,
  onRemove,
}: {
  regions: readonly CaptureReferenceRegion[];
  tone: "ignore" | "changed";
  onRemove?(index: number): void;
}) {
  return (
    <>
      {regions.map((region, index) => (
        <span
          key={`${region.x}:${region.y}:${index}`}
          className={`absolute top-(--region-y) left-(--region-x) h-(--region-h) w-(--region-w) rounded-sm ${
            tone === "ignore"
              ? "border border-dashed border-info bg-info/15"
              : "pointer-events-none border-2 border-diff"
          }`}
          style={
            {
              "--region-x": `${region.x * 100}%`,
              "--region-y": `${region.y * 100}%`,
              "--region-w": `${region.width * 100}%`,
              "--region-h": `${region.height * 100}%`,
            } as CSSProperties
          }
        >
          {onRemove ? (
            <button
              type="button"
              aria-label={`Remove ignore area ${region.name ?? index + 1}`}
              className="absolute -top-2.5 -right-2.5 flex size-5 items-center justify-center rounded-full bg-background text-foreground shadow ring-1 ring-border"
              onClick={(event) => {
                event.stopPropagation();
                onRemove(index);
              }}
            >
              <X className="size-3" aria-hidden="true" />
            </button>
          ) : null}
        </span>
      ))}
    </>
  );
}

/** Drag on the screenshot to add rectangles the comparison should ignore. */
function IgnoreAreaCanvas({
  regions,
  onChange,
}: {
  regions: CaptureReferenceRegion[];
  onChange(regions: CaptureReferenceRegion[]): void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState<{ x0: number; y0: number; x1: number; y1: number }>();
  const point = (event: ReactPointerEvent) => {
    const rect = box.current!.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height)),
    };
  };
  const normalized = draft
    ? {
        x: Math.min(draft.x0, draft.x1),
        y: Math.min(draft.y0, draft.y1),
        width: Math.abs(draft.x1 - draft.x0),
        height: Math.abs(draft.y1 - draft.y0),
      }
    : undefined;
  return (
    <div
      ref={box}
      className="absolute inset-0 cursor-crosshair touch-none"
      aria-label="Drag to mark an area to ignore"
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        const start = point(event);
        setDraft({ x0: start.x, y0: start.y, x1: start.x, y1: start.y });
      }}
      onPointerMove={(event) => {
        if (!draft) return;
        const next = point(event);
        setDraft({ ...draft, x1: next.x, y1: next.y });
      }}
      onPointerUp={() => {
        if (normalized && normalized.width > 0.01 && normalized.height > 0.01) {
          onChange([...regions, { ...normalized, name: `Area ${regions.length + 1}` }]);
        }
        setDraft(undefined);
      }}
    >
      <RegionBoxes
        regions={regions}
        tone="ignore"
        onRemove={(index) => onChange(regions.filter((_, other) => other !== index))}
      />
      {normalized ? <RegionBoxes regions={[normalized]} tone="ignore" /> : null}
    </div>
  );
}

/** The reference, clipped to the left of the swipe line, over this run's screenshot. */
function SwipeOverlay({ url, position }: { url: string; position: number }) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const element = box.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setWidth(element.clientWidth));
    observer.observe(element);
    setWidth(element.clientWidth);
    return () => observer.disconnect();
  }, []);
  return (
    <div
      ref={box}
      className="pointer-events-none absolute inset-0"
      style={{ "--swipe": `${position}%`, "--full": `${width}px` } as CSSProperties}
    >
      <div className="absolute inset-y-0 left-0 w-(--swipe) overflow-hidden rounded-l-md">
        <img
          src={url}
          alt=""
          draggable={false}
          className="h-full w-(--full) max-w-none object-contain select-none"
        />
      </div>
      <span aria-hidden="true" className="absolute inset-y-0 left-(--swipe) w-0.5 bg-diff" />
    </div>
  );
}

function formatDate(value?: number): string | undefined {
  if (!value) return undefined;
  return new Date(value).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function ReviewCompare({
  service,
  runId,
  item,
  finishedAt,
  mode,
  onModeChange,
  editingIgnore,
  onSaveIgnore,
  onCancelIgnore,
  savingIgnore,
}: {
  service: ReviewProductService;
  runId: string;
  item: CaptureReviewItem;
  finishedAt: number;
  mode: CompareMode;
  onModeChange(mode: CompareMode): void;
  editingIgnore: boolean;
  onSaveIgnore(regions: CaptureReferenceRegion[]): void;
  onCancelIgnore(): void;
  savingIgnore?: boolean;
}) {
  const reference = item.reference;
  const hasReference = Boolean(reference && reference.state !== "new");
  const capture = useReviewImage(service, "capture", runId, item);
  const approved = useReviewImage(service, "reference", runId, item, hasReference);
  const diff = useReviewImage(
    service,
    "diff",
    runId,
    item,
    hasReference && mode === "diff" && !editingIgnore,
  );
  const [swipe, setSwipe] = useState(50);
  const [regions, setRegions] = useState<CaptureReferenceRegion[]>(reference?.ignoreRegions ?? []);
  useEffect(() => {
    setRegions(reference?.ignoreRegions ?? []);
  }, [item.captureId, reference?.ignoreRegions]);

  const referenceDetail = hasReference
    ? `approved ${formatDate(reference?.referenceApprovedAt) ?? ""}`.trim()
    : undefined;
  const thisRun = `this run · ${formatDate(finishedAt) ?? ""}`;

  if (editingIgnore) {
    return (
      <div className="grid gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" disabled={savingIgnore} onClick={() => onSaveIgnore(regions)}>
            {savingIgnore ? "Comparing again…" : "Save and compare again"}
          </Button>
          <Button size="sm" variant="ghost" disabled={savingIgnore} onClick={onCancelIgnore}>
            Cancel
          </Button>
          <span className="text-xs text-muted-foreground tabular-nums">
            {regions.length === 1 ? "1 area" : `${regions.length} areas`} · drag over anything that
            changes on its own (clocks, live data, avatars); it’s left out of every comparison of
            this screen.
          </span>
        </div>
        <Shot
          url={capture.url}
          label="Mark areas to ignore"
          loading={capture.query.isPending}
          failed={capture.query.isError}
        >
          {capture.url ? <IgnoreAreaCanvas regions={regions} onChange={setRegions} /> : null}
        </Shot>
      </div>
    );
  }

  if (!hasReference) {
    return (
      <div className="grid gap-3">
        <Shot
          url={capture.url}
          label="New screenshot"
          detail={`${thisRun} · no reference yet`}
          loading={capture.query.isPending}
          failed={capture.query.isError}
        />
      </div>
    );
  }

  const changed = reference?.changedBounds ? [reference.changedBounds] : [];
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div
          role="radiogroup"
          aria-label="Comparison view"
          className="flex gap-1 rounded-lg bg-muted/40 p-0.5"
        >
          {(
            [
              ["side", "Side by side", "1"],
              ["diff", "Highlight changes", "2"],
              ["swipe", "Swipe", "3"],
            ] as const
          ).map(([value, label, key]) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={mode === value}
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-ring ${
                mode === value
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
              onClick={() => onModeChange(value)}
            >
              {label}
              <kbd className="ml-1.5 text-xs text-muted-foreground">{key}</kbd>
            </button>
          ))}
        </div>
        {reference?.ignoreRegions?.length ? (
          <span className="text-xs text-muted-foreground">
            Ignoring {reference.ignoreRegions.length}{" "}
            {reference.ignoreRegions.length === 1 ? "area" : "areas"}
          </span>
        ) : null}
      </div>
      {mode === "side" ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <Shot
            url={approved.url}
            label="Reference"
            detail={referenceDetail}
            loading={approved.query.isPending}
            failed={approved.query.isError}
          />
          <Shot
            url={capture.url}
            label="This run"
            detail={thisRun}
            loading={capture.query.isPending}
            failed={capture.query.isError}
          >
            <RegionBoxes regions={changed} tone="changed" />
          </Shot>
        </div>
      ) : mode === "diff" ? (
        <Shot
          url={diff.url}
          label="Changes"
          detail="Changed pixels in pink · ignored areas striped"
          loading={diff.query.isPending}
          failed={diff.query.isError}
        />
      ) : (
        <div className="grid gap-2">
          <Shot
            url={capture.url}
            label="Swipe"
            detail="Reference on the left of the line, this run on the right"
            loading={capture.query.isPending || approved.query.isPending}
            failed={capture.query.isError || approved.query.isError}
          >
            {approved.url ? <SwipeOverlay url={approved.url} position={swipe} /> : null}
          </Shot>
          <input
            type="range"
            min={0}
            max={100}
            value={swipe}
            aria-label="Swipe between reference and this run"
            className="w-full accent-foreground"
            onChange={(event) => setSwipe(Number(event.target.value))}
          />
        </div>
      )}
    </div>
  );
}

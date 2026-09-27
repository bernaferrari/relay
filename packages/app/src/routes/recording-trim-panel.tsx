import { Button } from "@relay/ui-react/components/button";
import { Slider } from "@relay/ui-react/components/slider";
import { useId, useRef, useState, type CSSProperties } from "react";
import { Scissors, RotateCcw, X } from "lucide-react";
import { formatDuration } from "./recording-review-presentation";

export function RecordingTrimPanel({
  durationMs,
  savedStartMs,
  savedEndMs,
  trimStartMs,
  trimEndMs,
  setTrimStartMs,
  setTrimEndMs,
  canEdit,
  onApply,
  moments = [],
  selectedId,
  onSelect,
}: {
  durationMs: number;
  savedStartMs?: number;
  savedEndMs?: number;
  trimStartMs: number;
  trimEndMs: number;
  setTrimStartMs(value: number): void;
  setTrimEndMs(value: number): void;
  canEdit: boolean;
  onApply(fromMs: number, toMs: number): void;
  moments?: readonly { id: string; label: string; timeMs: number }[];
  selectedId?: string;
  onSelect?(id: string): void;
}) {
  const [expanded, setExpanded] = useState(false);
  const panelId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const changed = trimStartMs !== (savedStartMs ?? 0) || trimEndMs !== (savedEndMs ?? durationMs);
  const timeWidth = `${Math.max(5, formatDuration(durationMs).length)}ch`;
  return (
    <div className="min-w-0">
      <div
        className={`grid transition-[grid-template-rows,opacity] duration-200 ease-out motion-reduce:transition-none ${expanded ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"}`}
        aria-hidden={!expanded}
        inert={!expanded}
      >
        <div className="min-h-0 overflow-hidden">
          <section
            id={panelId}
            className={`min-w-0 rounded-xl border border-border bg-card px-5 py-4 text-card-foreground transition-transform duration-200 ease-out motion-reduce:transition-none ${expanded ? "translate-y-0" : "translate-y-4"}`}
            aria-label="Recording timeline"
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="flex items-center gap-2 text-sm font-medium">
                <Scissors className="size-4 text-muted-foreground" aria-hidden="true" />
                Trim recording
              </h2>
              <div className="flex items-center gap-3 text-xs">
                <span className="text-muted-foreground">Start</span>
                <output
                  className="w-(--time-width) text-right font-mono tabular-nums"
                  style={{ "--time-width": timeWidth } as CSSProperties}
                >
                  {formatDuration(trimStartMs)}
                </output>
                <span className="text-muted-foreground">End</span>
                <output
                  className="w-(--time-width) text-right font-mono tabular-nums"
                  style={{ "--time-width": timeWidth } as CSSProperties}
                >
                  {formatDuration(trimEndMs)}
                </output>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={!canEdit || !changed}
                  onClick={() => {
                    setTrimStartMs(savedStartMs ?? 0);
                    setTrimEndMs(savedEndMs ?? durationMs);
                  }}
                  aria-label="Reset trim"
                >
                  <RotateCcw className="size-4" />
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!canEdit || !changed}
                  onClick={() => onApply(trimStartMs, trimEndMs)}
                >
                  Apply trim
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label="Close trim"
                  aria-expanded={true}
                  aria-controls={panelId}
                  onClick={() => {
                    triggerRef.current?.focus();
                    setExpanded(false);
                  }}
                >
                  <X className="size-4" />
                </Button>
              </div>
            </div>
            <Slider.Root
              className="mt-4"
              min={0}
              max={Math.max(1, durationMs)}
              step={1}
              value={[trimStartMs, trimEndMs]}
              disabled={!canEdit || durationMs <= 0}
              onValueChange={(values) => {
                setTrimStartMs(values[0]!);
                setTrimEndMs(values[1]!);
              }}
            >
              <Slider.Control className="relative flex h-10 w-full touch-none items-center select-none">
                <Slider.Track className="relative h-8 w-full rounded-md bg-muted">
                  <Slider.Indicator className="rounded-sm bg-primary/15 ring-1 ring-inset ring-primary/30" />
                  <div
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-0 flex justify-between px-2"
                  >
                    {Array.from({ length: 21 }, (_, i) => (
                      <span
                        key={i}
                        className={`self-end w-px bg-foreground/15 ${i % 5 === 0 ? "h-3" : "h-1.5"}`}
                      />
                    ))}
                  </div>
                </Slider.Track>
                {[0, 1].map((index) => (
                  <Slider.Thumb
                    key={index}
                    index={index}
                    getAriaLabel={() => (index === 0 ? "Start" : "End")}
                    getAriaValueText={(_, value) => formatDuration(value)}
                    className="flex h-10 w-3 cursor-ew-resize items-center justify-center rounded-sm border border-border bg-primary shadow-sm focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
                  >
                    <span className="h-4 w-px bg-primary-foreground/70" />
                  </Slider.Thumb>
                ))}
              </Slider.Control>
            </Slider.Root>
            {moments.length > 0 ? (
              <div
                className="mt-2 flex min-w-0 gap-1 overflow-x-auto pb-1"
                aria-label="Recorded moments"
              >
                {moments.map((moment, index) => (
                  <Button
                    key={moment.id}
                    size="sm"
                    variant={selectedId === moment.id ? "secondary" : "ghost"}
                    className="shrink-0"
                    aria-pressed={selectedId === moment.id}
                    title={moment.label}
                    onClick={() => onSelect?.(moment.id)}
                  >
                    <span className="font-mono text-xs tabular-nums text-muted-foreground">
                      {index + 1}
                    </span>
                    <span className="font-mono text-xs tabular-nums">
                      {formatDuration(moment.timeMs)}
                    </span>
                  </Button>
                ))}
              </div>
            ) : null}
            <div className="mt-2 flex justify-between text-xs text-muted-foreground">
              <span>Drag the handles to keep a time range</span>
              <span
                className="min-w-(--time-width) text-right font-mono tabular-nums"
                style={{ "--time-width": timeWidth } as CSSProperties}
              >
                {formatDuration(durationMs)}
              </span>
            </div>
          </section>
        </div>
      </div>
      <div className="flex justify-end">
        <Button
          ref={triggerRef}
          size="sm"
          variant="ghost"
          aria-expanded={expanded}
          aria-controls={panelId}
          onClick={() => setExpanded(!expanded)}
        >
          <Scissors className="size-4" />
          {expanded ? "Hide trim" : "Trim recording"}
        </Button>
      </div>
    </div>
  );
}

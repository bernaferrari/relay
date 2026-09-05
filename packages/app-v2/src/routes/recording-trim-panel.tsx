import { Button } from "@relay/ui-react/components/button";
import { Clock3 } from "lucide-react";
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
}) {
  return (
    <section
      className="grid min-w-0 grid-cols-1 items-center gap-5 rounded-xl border border-border bg-card px-4 py-3 text-card-foreground shadow-sm md:grid-cols-[auto_minmax(240px,1fr)_auto]"
      aria-labelledby="recording-trim-title"
    >
      <div className="flex items-center gap-2">
        <Clock3 aria-hidden="true" />
        <div>
          <p className="relay-section-label text-[11px] font-semibold uppercase tracking-[0.04em] text-[var(--text-weaker)]">
            Time range
          </p>
          <h2 id="recording-trim-title">
            {formatDuration(trimStartMs)} – {formatDuration(trimEndMs)}
          </h2>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <label className="grid gap-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          Start
          <input
            type="range"
            min={0}
            max={Math.max(1, durationMs)}
            value={trimStartMs}
            onChange={(event) =>
              setTrimStartMs(Math.min(Number(event.currentTarget.value), trimEndMs))
            }
            disabled={!canEdit}
          />
        </label>
        <label className="grid gap-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          End
          <input
            type="range"
            min={0}
            max={Math.max(1, durationMs)}
            value={trimEndMs}
            onChange={(event) =>
              setTrimEndMs(Math.max(Number(event.currentTarget.value), trimStartMs))
            }
            disabled={!canEdit}
          />
        </label>
      </div>
      <Button
        size="sm"
        variant="outline"
        onClick={() => onApply(trimStartMs, trimEndMs)}
        disabled={
          !canEdit ||
          (trimStartMs === (savedStartMs ?? 0) && trimEndMs === (savedEndMs ?? durationMs))
        }
      >
        Apply trim
      </Button>
    </section>
  );
}

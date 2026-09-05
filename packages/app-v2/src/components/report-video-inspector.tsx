/** @jsxImportSource react */
import { Button } from "@relay/ui-react/components/button";
import { useEffect, useRef, useState } from "react";
import type { ReportDiagnosticEvent, ReportVideoMedia } from "../data/run-report-model";

export type ReportVideoInterval = { startMs: number; endMs?: number };

/** Inspect only a server-approved persisted Run video and seek to canonical
 * trace intervals or diagnostic event timestamps. */
export function ReportVideoInspector({
  video,
  interval,
  diagnostics = [],
}: {
  video: ReportVideoMedia;
  interval?: ReportVideoInterval;
  diagnostics?: readonly ReportDiagnosticEvent[];
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const [selected, setSelected] = useState<string>();
  const [failed, setFailed] = useState(false);
  const [src, setSrc] = useState<string>();
  const [retry, setRetry] = useState(0);
  const [loading, setLoading] = useState(true);
  const pendingSeek = useRef<number | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    let localUrl: string | undefined;
    setSelected(undefined);
    setFailed(false);
    setLoading(true);
    setSrc(undefined);
    async function loadVideo() {
      if (!video.load) {
        if (active) setFailed(true);
        if (active) setLoading(false);
        return;
      }
      try {
        const blob = await video.load(controller.signal);
        if (!active || controller.signal.aborted) return;
        localUrl = URL.createObjectURL(blob);
        setSrc(localUrl);
        setLoading(false);
      } catch {
        if (active && !controller.signal.aborted) {
          setFailed(true);
          setLoading(false);
        }
      }
    }
    void loadVideo();
    return () => {
      active = false;
      controller.abort();
      if (localUrl) URL.revokeObjectURL(localUrl);
    };
  }, [video.load, retry]);
  useEffect(() => {
    pendingSeek.current = interval?.startMs ?? null;
    if (interval && ref.current?.readyState && ref.current.readyState >= 1) {
      ref.current.currentTime = Math.max(0, interval.startMs / 1_000);
      pendingSeek.current = null;
    }
  }, [interval?.startMs, src]);
  function seek(ms: number, id?: string) {
    if (ref.current && ref.current.readyState >= 1) {
      ref.current.currentTime = Math.max(0, ms / 1_000);
      pendingSeek.current = null;
    } else {
      pendingSeek.current = ms;
    }
    setSelected(id);
  }
  return (
    <section aria-label="Run video inspection" className="grid gap-3">
      {loading ? (
        <p role="status" className="rounded-lg border border-border bg-muted p-4 text-sm">
          Loading recorded video…
        </p>
      ) : failed ? (
        <div className="grid gap-2 rounded-lg border border-border bg-muted p-4 text-sm">
          <p role="alert">
            Recorded video could not be loaded. Saved image evidence remains available below.
          </p>
          <Button size="sm" variant="outline" onClick={() => setRetry((value) => value + 1)}>
            Retry loading video
          </Button>
        </div>
      ) : (
        <video
          ref={ref}
          controls
          muted
          aria-label="Recorded test execution"
          preload="metadata"
          src={src}
          onLoadedMetadata={() => {
            if (pendingSeek.current !== null && ref.current) {
              ref.current.currentTime = Math.max(0, pendingSeek.current / 1_000);
              pendingSeek.current = null;
            }
          }}
          onError={() => setFailed(true)}
          className="max-h-[32rem] w-full rounded-lg bg-black"
        />
      )}
      {diagnostics.length ? (
        <div className="flex flex-wrap gap-2" aria-label="Diagnostic events">
          {diagnostics
            .filter((event) => event.videoTimeMs !== undefined)
            .map((event) => (
              <Button
                key={event.id}
                size="sm"
                variant={selected === event.id ? "secondary" : "outline"}
                onClick={() => seek(event.videoTimeMs!, event.id)}
              >
                {event.title}
              </Button>
            ))}
        </div>
      ) : null}
    </section>
  );
}

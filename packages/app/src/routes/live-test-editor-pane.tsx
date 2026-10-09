/** @jsxImportSource react */
import { Badge } from "@relay/ui-react/components/badge";
import { useEffect, useRef, useState } from "react";
import type { LiveTestEditorSession } from "../data/live-test-editor-product-service";
import type { LiveTargetBrowserContext, LiveTargetStatus } from "../data/live-target-session";
import { LiveTargetCanvas } from "./live-target-canvas";
import { PageLoading, errorMessage } from "./recording-shared";

export function LiveTestEditorPane({
  session,
  loading,
  error,
}: {
  session?: LiveTestEditorSession;
  loading: boolean;
  error?: unknown;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [status, setStatus] = useState<LiveTargetStatus>("idle");
  const [browserContext, setBrowserContext] = useState<LiveTargetBrowserContext>();
  const [issue, setIssue] = useState<string>();
  const [busy, setBusy] = useState(false);
  const target = session?.liveTarget;

  useEffect(() => {
    if (!target || !canvas.current) {
      setBrowserContext(undefined);
      return;
    }
    const initial = target.snapshot();
    setStatus(initial.status);
    setBrowserContext(initial.browserContext);
    const unsubscribe = target.subscribe((snapshot) => {
      setStatus(snapshot.status);
      setBrowserContext(snapshot.browserContext);
      setIssue(snapshot.issue);
    });
    const unmount = target.mount(canvas.current);
    return () => {
      unmount();
      unsubscribe();
      target.close();
    };
  }, [target]);

  async function send(
    input: Parameters<LiveTestEditorSession["liveTarget"]["input"]>[0],
  ): Promise<boolean> {
    if (!session) return false;
    setBusy(true);
    setIssue(undefined);
    try {
      await session.liveTarget.input(input);
      return true;
    } catch (caught) {
      setIssue(errorMessage(caught));
      return false;
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      className="flex min-h-[min(72dvh,760px)] flex-col overflow-hidden rounded-xl border border-border bg-card"
      aria-labelledby="live-editor-title"
      data-slot="live-device-rail"
    >
      <div className="flex items-center justify-between gap-3 border-b border-border px-3.5 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <h2 id="live-editor-title" className="truncate text-sm font-medium">
            {session?.authoring.title ?? "Device"}
          </h2>
          {session ? (
            <Badge
              variant="secondary"
              className={
                status === "streaming"
                  ? "bg-success/15 text-success-foreground"
                  : status === "degraded"
                    ? "bg-warning/15 text-warning-foreground"
                    : undefined
              }
            >
              {status === "streaming" ? "Live" : status}
            </Badge>
          ) : null}
        </div>
      </div>
      {loading ? <PageLoading label="Opening the Device…" /> : null}
      {error ? (
        <p
          className="m-3 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm"
          role="alert"
        >
          {errorMessage(error)}
        </p>
      ) : null}
      {session ? (
        <div className="flex min-h-0 flex-1 flex-col">
          <LiveTargetCanvas
            canvasRef={canvas}
            status={status}
            issue={issue}
            busy={busy}
            targetTitle={session.authoring.title}
            showTargetDetails={false}
            targetDetail={session.authoring.target.kind === "browser" ? "Browser" : "Device"}
            browserContext={browserContext}
            directBrowser={session.authoring.target.kind === "browser"}
            send={send}
            recording={session.capabilities.record}
            layout="rail"
            helpText=""
          />
        </div>
      ) : null}
    </section>
  );
}

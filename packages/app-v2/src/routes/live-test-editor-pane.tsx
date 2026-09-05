/** @jsxImportSource react */
import { Badge } from "@relay/ui-react/components/badge";
import { Button } from "@relay/ui-react/components/button";
import { Link } from "@tanstack/react-router";
import { RadioTower } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { LiveTestEditorSession } from "../data/live-test-editor-product-service";
import type { LiveTargetStatus } from "../data/live-target-session";
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
  const [issue, setIssue] = useState<string>();
  const [busy, setBusy] = useState(false);
  const target = session?.liveTarget;

  useEffect(() => {
    if (!target || !canvas.current) return;
    setStatus(target.snapshot().status);
    const unsubscribe = target.subscribe((snapshot) => {
      setStatus(snapshot.status);
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
    <section className="grid gap-3" aria-labelledby="live-editor-title">
      <div className="relay-section-heading">
        <div>
          <p className="relay-section-label">Live Session</p>
          <h2 id="live-editor-title">Live target</h2>
        </div>
        {session ? (
          <Button
            size="sm"
            variant="ghost"
            nativeButton={false}
            render={<Link to="/sessions/$sessionId" params={{ sessionId: session.authoring.id }} />}
          >
            <RadioTower aria-hidden="true" /> Open Session
          </Button>
        ) : null}
      </div>
      {loading ? <PageLoading label="Opening live Session…" /> : null}
      {error ? (
        <p className="rounded-md border border-red-500/30 bg-red-500/5 p-3 text-sm" role="alert">
          {errorMessage(error)}
        </p>
      ) : null}
      {session ? (
        <>
          <div className="text-sm text-muted-foreground">
            <Badge
              variant="secondary"
              className={
                status === "streaming"
                  ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                  : status === "degraded"
                    ? "bg-amber-500/15 text-amber-700 dark:text-amber-300"
                    : undefined
              }
            >
              {status === "streaming" ? "Live" : status}
            </Badge>
            <span>{session.authoring.target.targetId}</span>
          </div>
          <LiveTargetCanvas
            canvasRef={canvas}
            status={status}
            issue={issue}
            busy={busy}
            targetTitle={session.authoring.title}
            targetDetail={`Owned by ${session.authoring.actorId}`}
            send={send}
            recording={session.capabilities.record}
            helpText={
              session.capabilities.record
                ? "Live interactions are attached to this active Recording."
                : "Use the target to inspect state while editing. Interactions here do not add or replace Test steps."
            }
          />
        </>
      ) : null}
    </section>
  );
}

/** @jsxImportSource react */
import { Badge, Button } from "@relay/ui-react";
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

  async function send(input: Parameters<LiveTestEditorSession["liveTarget"]["input"]>[0]) {
    if (!session) return;
    setBusy(true);
    setIssue(undefined);
    try {
      await session.liveTarget.input(input);
    } catch (caught) {
      setIssue(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="relay-live-editor-pane" aria-labelledby="live-editor-title">
      <div className="relay-section-heading">
        <div>
          <p className="relay-section-label">Live Session</p>
          <h2 id="live-editor-title">Live target</h2>
        </div>
        {session ? (
          <Button
            size="small"
            variant="ghost"
            render={<Link to="/sessions/$sessionId" params={{ sessionId: session.authoring.id }} />}
          >
            <RadioTower aria-hidden="true" /> Open Session
          </Button>
        ) : null}
      </div>
      {loading ? <PageLoading label="Opening live Session…" /> : null}
      {error ? (
        <p className="relay-live-editor-error" role="alert">
          {errorMessage(error)}
        </p>
      ) : null}
      {session ? (
        <>
          <div className="relay-live-editor-status">
            <Badge
              variant={
                status === "streaming" ? "success" : status === "degraded" ? "warning" : "secondary"
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

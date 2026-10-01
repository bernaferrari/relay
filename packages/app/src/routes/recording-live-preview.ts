import { errorMessage, liveIssueMessage } from "./recording-shared";
import { useEffect, useRef, useState } from "react";
import type { RecordingProductService } from "../data/recording-product-service";
import type {
  LiveTargetBrowserContext,
  LiveTargetSession,
  LiveTargetStatus,
} from "../data/live-target-session";

/** Own one preview connection independently of the recording's durable input ledger. */
export function useRecordingLivePreview({
  enabled,
  selectedTarget,
  createLiveTarget,
}: {
  enabled: boolean;
  selectedTarget: Parameters<NonNullable<RecordingProductService["liveTarget"]>>[0] | undefined;
  createLiveTarget: RecordingProductService["liveTarget"];
}) {
  const liveCanvas = useRef<HTMLCanvasElement>(null);
  const liveSession = useRef<LiveTargetSession | undefined>(undefined);
  const [liveStatus, setLiveStatus] = useState<LiveTargetStatus>("idle");
  const [previewAttempt, setPreviewAttempt] = useState(0);
  const [browserContext, setBrowserContext] = useState<LiveTargetBrowserContext>();
  const [previewIssue, setPreviewIssue] = useState<string>();

  useEffect(() => {
    if (!enabled || !selectedTarget || !liveCanvas.current || !createLiveTarget) {
      setLiveStatus("idle");
      setPreviewIssue(undefined);
      return;
    }
    let disposed = false;
    let stop: (() => void) | undefined;
    let unsubscribe: (() => void) | undefined;
    let mountedSession: LiveTargetSession | undefined;
    setLiveStatus("connecting");
    setPreviewIssue(undefined);
    setBrowserContext(undefined);
    // Show the same signed-in browser the recording drives.
    const account =
      selectedTarget.kind === "browser" ? selectedTarget.authenticationFixtureId : undefined;
    void createLiveTarget(
      selectedTarget,
      account ? { authenticationFixtureId: account } : undefined,
    )
      .then((session) => {
        if (disposed || !liveCanvas.current) {
          session.close();
          return;
        }
        mountedSession = session;
        liveSession.current = session;
        unsubscribe = session.subscribe((next) => {
          setLiveStatus(next.status);
          setBrowserContext(next.browserContext);
          setPreviewIssue(next.issue ? liveIssueMessage(next.issue) : undefined);
        });
        stop = session.mount(liveCanvas.current);
      })
      .catch((error: unknown) => {
        if (!disposed) {
          setLiveStatus("degraded");
          setPreviewIssue(liveIssueMessage(errorMessage(error)));
        }
      });
    return () => {
      disposed = true;
      stop?.();
      unsubscribe?.();
      if (liveSession.current === mountedSession) liveSession.current = undefined;
      mountedSession?.close();
    };
  }, [enabled, createLiveTarget, selectedTarget?.targetId, previewAttempt]);
  return {
    liveCanvas,
    liveSession,
    liveStatus,
    browserContext,
    previewIssue,
    reconnect: () => setPreviewAttempt((attempt) => attempt + 1),
  };
}

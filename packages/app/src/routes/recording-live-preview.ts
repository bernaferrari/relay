import type { TalkBackCaptureResult } from "../data/talkback-overlay";
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
  inspectAccessibility = true,
}: {
  enabled: boolean;
  selectedTarget: Parameters<NonNullable<RecordingProductService["liveTarget"]>>[0] | undefined;
  createLiveTarget: RecordingProductService["liveTarget"];
  inspectAccessibility?: boolean;
}) {
  const liveCanvas = useRef<HTMLCanvasElement>(null);
  const liveSession = useRef<LiveTargetSession | undefined>(undefined);
  const [liveStatus, setLiveStatus] = useState<LiveTargetStatus>("idle");
  const [previewAttempt, setPreviewAttempt] = useState(0);
  const [browserContext, setBrowserContext] = useState<LiveTargetBrowserContext>();
  const [previewIssue, setPreviewIssue] = useState<string>();
  const [browserAccessibility, setBrowserAccessibility] = useState<TalkBackCaptureResult>();
  const inspect = useRef(inspectAccessibility);
  inspect.current = inspectAccessibility;

  useEffect(() => {
    liveSession.current?.setAccessibilityInspection?.(inspectAccessibility);
  }, [inspectAccessibility]);

  useEffect(() => {
    if (!enabled || !selectedTarget || !liveCanvas.current || !createLiveTarget) {
      setLiveStatus("idle");
      setPreviewIssue(undefined);
      setBrowserAccessibility(undefined);
      return;
    }
    let disposed = false;
    let stop: (() => void) | undefined;
    let unsubscribe: (() => void) | undefined;
    let mountedSession: LiveTargetSession | undefined;
    setLiveStatus("connecting");
    setPreviewIssue(undefined);
    setBrowserContext(undefined);
    setBrowserAccessibility(undefined);
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
        session.setAccessibilityInspection?.(inspect.current);
        unsubscribe = session.subscribe((next) => {
          setLiveStatus(next.status);
          setBrowserContext(next.browserContext);
          setBrowserAccessibility(next.status === "streaming" ? next.accessibility : undefined);
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
    browserAccessibility,
    previewIssue,
    reconnect: () => setPreviewAttempt((attempt) => attempt + 1),
  };
}

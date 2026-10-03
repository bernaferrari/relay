import { useEffect, useRef, type RefObject } from "react";
import type { AuthoringTarget } from "@relay/protocol";
import type { LiveTargetSession, LiveTargetSnapshot } from "../data/live-target-session";
import type { RecordingProductService } from "../data/recording-product-service";

/** Own the preview transport separately from the durable input recovery ledger. */
export function useNewTestPreviewSession({
  target,
  canvas,
  sessionRef,
  service,
  attempt,
  mode,
  enabled,
  onSnapshot,
}: {
  target?: AuthoringTarget;
  canvas: RefObject<HTMLCanvasElement | null>;
  sessionRef: { current: LiveTargetSession | undefined };
  service: Pick<RecordingProductService, "previewTarget">;
  attempt: number;
  mode: string;
  enabled: boolean;
  onSnapshot(snapshot: Omit<LiveTargetSnapshot, "target">): void;
}) {
  const listener = useRef(onSnapshot);
  listener.current = onSnapshot;
  useEffect(() => {
    if (!enabled) return;
    if (!target || !canvas.current || !service.previewTarget) {
      listener.current({ status: "idle" });
      return;
    }
    let disposed = false;
    let unmount: (() => void) | undefined;
    let unsubscribe: (() => void) | undefined;
    let session: LiveTargetSession | undefined;
    listener.current({ status: "connecting" });
    void service
      .previewTarget(target)
      .then((next) => {
        if (disposed || !canvas.current) return next.close();
        session = next;
        sessionRef.current = next;
        unsubscribe = next.subscribe((snapshot) => {
          if (!disposed) listener.current(snapshot);
        });
        unmount = next.mount(canvas.current);
      })
      .catch(() => {
        if (!disposed)
          listener.current({
            status: "degraded",
            issue: "The device preview could not connect. Reopen the preview to try again.",
          });
      });
    return () => {
      disposed = true;
      unmount?.();
      unsubscribe?.();
      if (sessionRef.current === session) sessionRef.current = undefined;
      session?.close();
    };
  }, [attempt, canvas, enabled, mode, service, sessionRef, target?.targetId]);
}

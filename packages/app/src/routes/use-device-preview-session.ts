import { useCallback, useEffect, useRef, useState } from "react";
import type { AuthoringTarget } from "@relay/protocol";
import type { LiveTargetSession, LiveTargetSnapshot } from "../data/live-target-session";
import type { RecordingProductService } from "../data/recording-product-service";
import { errorMessage } from "./recording-shared";

/** Keep observation owned by the exact canvas currently rendered by DevicePage. */
export function useDevicePreviewSession({
  enabled,
  target,
  attempt,
  createPreview,
  inspectAccessibility,
  onSnapshot,
}: {
  enabled: boolean;
  target?: AuthoringTarget | null;
  attempt: number;
  createPreview: RecordingProductService["previewTarget"];
  inspectAccessibility: boolean;
  onSnapshot(snapshot: Omit<LiveTargetSnapshot, "target">): void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const session = useRef<LiveTargetSession | undefined>(undefined);
  const [canvasNode, setCanvasNode] = useState<HTMLCanvasElement | null>(null);
  const dispose = useRef<(() => void) | undefined>(undefined);
  const listener = useRef(onSnapshot);
  listener.current = onSnapshot;
  const inspection = useRef(inspectAccessibility);
  inspection.current = inspectAccessibility;

  const onCanvasChange = useCallback((node: HTMLCanvasElement | null) => {
    if (canvas.current === node) return;
    dispose.current?.();
    canvas.current = node;
    listener.current({ status: "idle" });
    setCanvasNode(node);
  }, []);

  useEffect(() => {
    session.current?.setAccessibilityInspection?.(inspectAccessibility);
  }, [inspectAccessibility]);

  useEffect(() => {
    if (!enabled || !target || !canvasNode || !createPreview) {
      listener.current({ status: "idle" });
      return;
    }
    let disposed = false;
    let unmount: (() => void) | undefined;
    let unsubscribe: (() => void) | undefined;
    let mounted: LiveTargetSession | undefined;
    const release = () => {
      if (disposed) return;
      disposed = true;
      unsubscribe?.();
      unmount?.();
      if (session.current === mounted) session.current = undefined;
      mounted?.close();
      if (dispose.current === release) dispose.current = undefined;
    };
    dispose.current = release;
    listener.current({ status: "connecting" });
    void createPreview(target)
      .then((next) => {
        if (disposed || canvas.current !== canvasNode) return next.close();
        mounted = next;
        session.current = next;
        next.setAccessibilityInspection?.(inspection.current);
        unsubscribe = next.subscribe((snapshot) => {
          if (!disposed && canvas.current === canvasNode) listener.current(snapshot);
        });
        unmount = next.mount(canvasNode);
      })
      .catch((error: unknown) => {
        if (!disposed && canvas.current === canvasNode)
          listener.current({ status: "degraded", issue: errorMessage(error) });
      });
    return release;
  }, [attempt, canvasNode, createPreview, enabled, target]);

  return { canvas, session, onCanvasChange };
}

/** @jsxImportSource react */
import { useEffect, useRef, useState } from "react";
import { useRouteContext } from "@tanstack/react-router";
import type { ProductTargetOption } from "../data/target-presentation";
import type {
  LiveTargetInput,
  LiveTargetSession,
  LiveTargetSnapshot,
} from "../data/live-target-session";
import { DeviceLivePreview } from "./device-live-preview";
import { useTalkBackReview } from "./talkback-review-panel";
import { errorMessage } from "./recording-shared";

/** Inspect the selected physical device through the same Relay preview transport as recording. */
export function TestDevicePane({
  target,
  onBusyChange,
}: {
  target: ProductTargetOption;
  onBusyChange?(busy: boolean): void;
}) {
  const { productService, platform } = useRouteContext({ from: "__root__" });
  const canvas = useRef<HTMLCanvasElement>(null);
  const session = useRef<LiveTargetSession | undefined>(undefined);
  const inputPending = useRef(false);
  const [snapshot, setSnapshot] = useState<LiveTargetSnapshot>({ status: "connecting", target });
  const [attempt, setAttempt] = useState(0);
  const [refresh, setRefresh] = useState(0);
  const [busy, setBusy] = useState(false);
  const [issue, setIssue] = useState<string>();
  useEffect(() => {
    onBusyChange?.(busy);
    return () => onBusyChange?.(false);
  }, [busy, onBusyChange]);
  const talkBack = useTalkBackReview({
    enabled: snapshot.status === "streaming",
    serial: target.targetId,
    capture: productService.reviewTalkBack,
    refreshKey: refresh,
    platform,
  });
  useEffect(() => {
    let disposed = false;
    let close: (() => void) | undefined;
    const createPreview = productService.previewTarget;
    setSnapshot({ status: "connecting", target });
    setIssue(undefined);
    if (!createPreview) {
      setSnapshot({ status: "degraded", target });
      setIssue("Live device preview is unavailable.");
      return;
    }
    void createPreview(target)
      .then((next) => {
        if (disposed || !canvas.current) return next.close();
        session.current = next;
        const unsubscribe = next.subscribe(setSnapshot);
        const unmount = next.mount(canvas.current);
        setSnapshot(next.snapshot());
        close = () => {
          unsubscribe();
          unmount();
          if (session.current === next) session.current = undefined;
          next.close();
        };
      })
      .catch((error: unknown) => {
        if (!disposed) {
          setSnapshot({ status: "degraded", target });
          setIssue(errorMessage(error));
        }
      });
    return () => {
      disposed = true;
      close?.();
    };
  }, [productService, target.targetId, target.platform, attempt]);
  async function send(input: LiveTargetInput) {
    if (!session.current || inputPending.current) return false;
    inputPending.current = true;
    setBusy(true);
    setIssue(undefined);
    try {
      await session.current.input(input);
      setRefresh((value) => value + 1);
      return true;
    } catch (error) {
      setIssue(errorMessage(error));
      return false;
    } finally {
      inputPending.current = false;
      setBusy(false);
    }
  }
  return (
    <DeviceLivePreview
      platform={target.platform}
      canvas={canvas}
      target={target}
      status={snapshot.status}
      issue={issue ?? snapshot.issue}
      busy={busy}
      send={send}
      pending={snapshot.status === "connecting"}
      reconnecting={snapshot.status === "connecting"}
      reconnect={() => setAttempt((value) => value + 1)}
      talkBack={talkBack}
    />
  );
}

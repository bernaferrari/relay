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
import { RecordingInputRecovery } from "./recording-input-recovery";
import {
  dispatchRecordingInput,
  mergeHydratedRecordingLedger,
  parseRecordingLedger,
  recordingRecoveryBlocksSend,
  reconcileRecordingMutationAuthoritatively,
  unresolvedRecordingMutation,
  type RecordingRecoveryLedger,
  type RecordingObservedEffect,
} from "../data/recording-input-outcome";

/** Inspect the selected physical device through the same Relay preview transport as recording. */
export function TestDevicePane({
  target,
  onBusyChange,
}: {
  target: ProductTargetOption;
  onBusyChange?(busy: boolean): void;
}) {
  return (
    <TestDeviceView
      key={`${target.platform}:${target.targetId}`}
      target={target}
      onBusyChange={onBusyChange}
    />
  );
}

function TestDeviceView({
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
  const ledger = useRef<RecordingRecoveryLedger>({ mutations: [] });
  const [failure, setFailure] = useState<ReturnType<typeof unresolvedRecordingMutation>>();
  const [checkingInput, setCheckingInput] = useState(true);
  const active = useRef(true);
  const storageKey = `live-input-ledger:${target.platform}:${target.targetId}`;
  useEffect(() => {
    let disposed = false;
    active.current = true;
    setCheckingInput(true);
    void Promise.all([
      platform.storage.get(storageKey),
      productService.inspectTargetHealth?.(target.targetId),
    ])
      .then(([stored, health]) => {
        if (disposed) return;
        ledger.current = mergeHydratedRecordingLedger({
          stored: parseRecordingLedger(stored),
          inMemory: ledger.current,
          health,
        }).ledger;
        setFailure(unresolvedRecordingMutation(ledger.current, "unknown"));
        setCheckingInput(false);
      })
      .catch((error: unknown) => {
        if (!disposed) setIssue(`Could not check the last input. ${errorMessage(error)}`);
      });
    return () => {
      disposed = true;
      active.current = false;
    };
  }, [platform, productService, storageKey, target.targetId, attempt]);

  async function retain(next: RecordingRecoveryLedger) {
    ledger.current = next;
    if (active.current) setFailure(unresolvedRecordingMutation(next, "unknown"));
    await platform.storage.set(storageKey, JSON.stringify(next));
  }

  async function observe(observed: RecordingObservedEffect) {
    if (!failure?.mutationId || !productService.reconcileInput || inputPending.current) return;
    inputPending.current = true;
    setBusy(true);
    try {
      await retain(
        await reconcileRecordingMutationAuthoritatively({
          ledger: ledger.current,
          mutationId: failure.mutationId,
          observed,
          authority: {
            serial: target.targetId,
            reconcile: productService.reconcileInput,
            fetchReceipt: productService.fetchReconcileReceipt,
          },
        }),
      );
      if (active.current) {
        setIssue(undefined);
        setRefresh((value) => value + 1);
      }
    } catch (error) {
      if (active.current) setIssue(errorMessage(error));
    } finally {
      inputPending.current = false;
      if (active.current) setBusy(false);
    }
  }
  useEffect(() => {
    onBusyChange?.(busy || checkingInput || Boolean(failure));
    return () => onBusyChange?.(false);
  }, [busy, checkingInput, failure, onBusyChange]);
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
    if (
      !session.current ||
      inputPending.current ||
      checkingInput ||
      recordingRecoveryBlocksSend(ledger.current)
    )
      return false;
    const owned = session.current;
    inputPending.current = true;
    setBusy(true);
    setIssue(undefined);
    try {
      const outcome = await dispatchRecordingInput({
        send: () => owned.input(input),
        refresh: async () => {},
        ledger: ledger.current,
      });
      if (outcome.kind === "unknown") await retain({ mutations: [outcome] });
      if (active.current) {
        if (outcome.kind === "confirmed") setRefresh((value) => value + 1);
        else if (outcome.kind === "not-dispatched")
          setIssue(`Input was not sent. ${outcome.message}`);
      }
      return outcome.kind === "confirmed";
    } catch (error) {
      if (active.current) setIssue(errorMessage(error));
      return false;
    } finally {
      inputPending.current = false;
      if (active.current) setBusy(false);
    }
  }
  return (
    <>
      <DeviceLivePreview
        platform={target.platform}
        canvas={canvas}
        target={target}
        status={snapshot.status}
        issue={issue ?? snapshot.issue}
        busy={busy || checkingInput || Boolean(failure)}
        send={send}
        pending={snapshot.status === "connecting"}
        reconnecting={snapshot.status === "connecting"}
        reconnect={() => setAttempt((value) => value + 1)}
        talkBack={talkBack}
      />
      {failure ? (
        <RecordingInputRecovery
          failure={failure}
          busy={busy || !productService.reconcileInput}
          issue={issue ?? "Input outcome unknown. Check the live screen before continuing."}
          onObserve={observe}
        />
      ) : null}
    </>
  );
}

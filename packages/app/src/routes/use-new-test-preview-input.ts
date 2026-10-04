import { useEffect, useMemo, useRef, useState } from "react";
import type { LiveTargetInput, LiveTargetSession } from "../data/live-target-session";
import type { RecordingProductService } from "../data/recording-product-service";
import type { ProductTargetOption } from "../data/target-presentation";
import type { PlatformStorage } from "../platform/types";
import {
  dispatchRecordingInput,
  mergeHydratedRecordingLedger,
  parseRecordingLedger,
  recordingRecoveryBlocksSend,
  reconcileRecordingMutationAuthoritatively,
  unresolvedRecordingMutation,
  type RecordingObservedEffect,
  type RecordingRecoveryLedger,
} from "../data/recording-input-outcome";

type InputService = Pick<
  RecordingProductService,
  "inspectTargetHealth" | "reconcileInput" | "fetchReconcileReceipt"
>;

/** Exploration uses the same durable target fence as recording and Test inspection. */
export function useNewTestPreviewInput({
  target,
  session,
  storage,
  service,
  attempt,
}: {
  target?: ProductTargetOption;
  session: { current: LiveTargetSession | undefined };
  storage: PlatformStorage;
  service: InputService;
  attempt: number;
}) {
  const [, redraw] = useState(0);
  const scope = useMemo(
    () => ({
      serial: target?.targetId,
      storageKey: `live-input-ledger:${target?.platform}:${target?.targetId}`,
      ledger: { mutations: [] } as RecordingRecoveryLedger,
      checking: Boolean(target),
      pending: false,
      issue: undefined as string | undefined,
    }),
    [target?.platform, target?.targetId, storage, service],
  );
  const current = useRef<typeof scope | undefined>(scope);
  current.current = scope;
  function notify() {
    if (current.current === scope) redraw((value) => value + 1);
  }
  useEffect(() => {
    let disposed = false;
    current.current = scope;
    if (!scope.serial) return;
    scope.checking = true;
    notify();
    void Promise.all([storage.get(scope.storageKey), service.inspectTargetHealth?.(scope.serial)])
      .then(([stored, health]) => {
        if (disposed) return;
        scope.ledger = mergeHydratedRecordingLedger({
          stored: parseRecordingLedger(stored),
          inMemory: scope.ledger,
          health,
        }).ledger;
        scope.checking = false;
        scope.issue = undefined;
        notify();
      })
      .catch(() => {
        if (disposed) return;
        scope.issue = "Could not check the last interaction. Reconnect the preview.";
        notify();
      });
    return () => {
      disposed = true;
      if (current.current === scope) current.current = undefined;
    };
  }, [scope, attempt]);

  async function retain(next: RecordingRecoveryLedger) {
    // Fence immediately, even if durable storage fails or this target was switched.
    scope.ledger = next;
    notify();
    await storage.set(scope.storageKey, JSON.stringify(next));
  }
  async function send(input: LiveTargetInput) {
    if (scope.pending || scope.checking || recordingRecoveryBlocksSend(scope.ledger)) return false;
    const owned = session.current;
    if (!owned || !scope.serial) {
      scope.issue = "The live view is still connecting.";
      notify();
      return false;
    }
    scope.pending = true;
    scope.issue = undefined;
    notify();
    try {
      const outcome = await dispatchRecordingInput({
        send: () => owned.input(input),
        refresh: async () => {},
        ledger: scope.ledger,
      });
      if (outcome.kind === "unknown") await retain({ mutations: [outcome] });
      if (outcome.kind === "not-dispatched") scope.issue = `Input was not sent. ${outcome.message}`;
      return outcome.kind === "confirmed";
    } catch {
      scope.issue = "Could not save the last interaction. Keep input paused and check the preview.";
      return false;
    } finally {
      scope.pending = false;
      notify();
    }
  }
  async function observe(observed: RecordingObservedEffect) {
    const failure = unresolvedRecordingMutation(scope.ledger, "unknown");
    if (!failure?.mutationId || !scope.serial || !service.reconcileInput || scope.pending) return;
    scope.pending = true;
    notify();
    try {
      await retain(
        await reconcileRecordingMutationAuthoritatively({
          ledger: scope.ledger,
          mutationId: failure.mutationId,
          observed,
          authority: {
            serial: scope.serial,
            platform: target?.platform,
            reconcile: service.reconcileInput,
            fetchReceipt: service.fetchReconcileReceipt,
          },
        }),
      );
      scope.issue = undefined;
    } catch {
      scope.issue = "Could not confirm the last interaction. Check the preview, then try again.";
    } finally {
      scope.pending = false;
      notify();
    }
  }
  const failure = unresolvedRecordingMutation(scope.ledger, "unknown");
  return {
    send,
    observe,
    failure,
    issue: scope.issue,
    busy: scope.pending || scope.checking || Boolean(failure),
    recoveryBusy: scope.pending || !service.reconcileInput,
  };
}

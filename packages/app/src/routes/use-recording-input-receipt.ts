import { useEffect, useMemo, useRef } from "react";
import type { AuthoringTarget } from "@relay/protocol";
import type { RecordingInputOutcome } from "../data/recording-input-outcome";
import type { RecordingProductService } from "../data/recording-product-service";

/** A bounded read-only wait for the receipt of one input. It never dispatches
 * or reconciles input, and its result cannot cross recording/target changes. */
export function useRecordingInputReceipt({
  failure,
  workflowId,
  target,
  service,
  onConfirmed,
}: {
  failure?: RecordingInputOutcome;
  workflowId: string;
  target?: AuthoringTarget;
  service: RecordingProductService;
  onConfirmed: (failure: RecordingInputOutcome, isCurrent: () => boolean) => Promise<void>;
}) {
  const callback = useRef(onConfirmed);
  callback.current = onConfirmed;
  const serial = target?.targetId;
  const kind = target?.kind;
  const platform = target?.platform;
  const fixture = target?.kind === "browser" ? target.authenticationFixtureId : undefined;
  const liveSession = target?.kind === "browser" ? target.liveSessionId : undefined;
  // Invalidate old async work during render. A replacement can suspend before
  // passive effect cleanup, while its callback ref has already changed.
  const ownership = useMemo(
    () => ({}),
    [failure, workflowId, serial, kind, platform, fixture, liveSession, service],
  );
  const currentOwnership = useRef(ownership);
  currentOwnership.current = ownership;
  useEffect(() => {
    const reference = failure?.kind === "unknown" ? failure.recordingMutation : undefined;
    const fetchReceipt = service.fetchRecordingInputReceipt;
    if (
      !reference?.target ||
      typeof reference.mutationId !== "string" ||
      !reference.mutationId.trim() ||
      !fetchReceipt ||
      reference.workflowId !== workflowId ||
      !Number.isSafeInteger(reference.transitionVersion) ||
      reference.transitionVersion < 1 ||
      typeof reference.sessionId !== "string" ||
      !reference.sessionId ||
      reference.target.kind !== kind ||
      reference.target.platform !== platform ||
      reference.target.targetId !== serial ||
      (reference.target.kind === "browser" &&
        (reference.target.authenticationFixtureId !== fixture ||
          reference.target.liveSessionId !== liveSession))
    )
      return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = Date.now() + 60_000;
    const isCurrent = () => !disposed && currentOwnership.current === ownership;
    async function inspect() {
      try {
        const receipt = await fetchReceipt!(reference!);
        if (!isCurrent()) return;
        if (receipt.outcome === "applied") {
          await callback.current(failure!, isCurrent);
          return;
        }
        if (receipt.outcome === "failed") return;
      } catch {
        // A missing or unavailable receipt cannot release the input fence.
      }
      if (isCurrent() && Date.now() < deadline) timer = setTimeout(() => void inspect(), 750);
    }
    void inspect();
    return () => {
      disposed = true;
      clearTimeout(timer);
    };
  }, [failure, workflowId, serial, kind, platform, fixture, liveSession, service, ownership]);
}

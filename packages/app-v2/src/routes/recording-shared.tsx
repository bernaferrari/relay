/** @jsxImportSource react */
import { Button } from "@relay/ui-react";
import type { ProductRecordingRecovery } from "../data/recording-product-service";

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Relay could not complete this request.";
}

export function PageLoading({ label }: { label: string }) {
  return (
    <div className="relay-recording-loading" role="status">
      <span className="relay-recording-loading-mark" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}

export function RecordingProblem({
  recovery,
  error,
  onRetry,
  retrying = false,
}: {
  recovery?: ProductRecordingRecovery;
  error?: unknown;
  onRetry?: () => void;
  retrying?: boolean;
}) {
  if (!recovery && !error) return null;
  return (
    <div className="relay-recording-problem" role="alert">
      <div>
        <h2>{recovery?.title ?? "Relay could not load this recording"}</h2>
        <p>{recovery?.detail ?? errorMessage(error)}</p>
        {recovery?.recovery ? (
          <p className="relay-recording-recovery">{recovery.recovery}</p>
        ) : null}
      </div>
      {onRetry && (recovery?.retryable ?? true) ? (
        <Button size="small" onClick={onRetry} disabled={retrying}>
          {retrying ? "Trying again…" : "Try again"}
        </Button>
      ) : null}
    </div>
  );
}

export function targetLabel(target: {
  kind: "device" | "browser";
  platform: "android" | "ios" | "browser";
  targetId: string;
}): { title: string; detail: string } {
  if (target.kind === "browser") {
    return { title: target.targetId, detail: "Managed browser" };
  }
  return {
    title: target.targetId,
    detail: target.platform === "ios" ? "Ready iOS device" : "Ready Android device",
  };
}

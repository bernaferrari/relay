/** @jsxImportSource react */
import { Button, Skeleton } from "@relay/ui-react";
import { projectError } from "@relay/product/errors";
import { RotateCcw } from "lucide-react";
import { RecoveryState } from "../components/product-patterns";
type ProductRecovery = {
  code?: string;
  title: string;
  detail: string;
  recovery: string;
  retryable: boolean;
};

export function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  if (/raw accessibility|immutable raw|offline geometry|raw-evidence/iu.test(message)) {
    return "Relay needs a fresh capture of the starting screen before this Test can run.";
  }
  if (/target selection is ambiguous|choose one by id/iu.test(message)) {
    return "Choose one ready device or browser, then try again.";
  }
  if (/app map selection is ambiguous/iu.test(message)) {
    return "Choose the app that owns this Test, then try again.";
  }
  if (/this test appears in more than one app/iu.test(message)) {
    return "This Test appears in more than one app and cannot be opened safely.";
  }
  if (/no connected .+ target is ready|nothing is ready/iu.test(message)) {
    return "No device or managed browser is ready. Connect one, then try again.";
  }
  if (/failed to fetch|networkerror|connection (?:ended|failed|refused)/iu.test(message)) {
    return "Relay could not reach the local service. Check the connection, then try again.";
  }
  if (/workflow|expectedversion|operationid|identifier is invalid/iu.test(message)) {
    return "Relay could not restore this work. Return to the Test and try again.";
  }
  return "Relay could not complete this request. Try again, or return to the Test.";
}

export function PageLoading({ label }: { label: string }) {
  return (
    <div className="relay-recording-loading" role="status" aria-live="polite">
      <span className="relay-visually-hidden">{label}</span>
      <div className="relay-recording-loading-copy" aria-hidden="true">
        <Skeleton className="relay-recording-loading-title" />
        <Skeleton className="relay-recording-loading-line" />
      </div>
      <div className="relay-recording-loading-grid" aria-hidden="true">
        <Skeleton />
        <Skeleton />
      </div>
    </div>
  );
}

export function RecordingProblem({
  recovery,
  error,
  onRetry,
  retrying = false,
  layout = "compact",
  className,
}: {
  recovery?: ProductRecovery;
  error?: unknown;
  onRetry?: () => void;
  retrying?: boolean;
  layout?: "compact" | "centered";
  className?: string;
}) {
  if (!recovery && !error) return null;
  const projectedError = error ? projectError(error) : undefined;
  const publicRecovery = recovery
    ? recoveryCopy(recovery)
    : projectedError?.title !== "Something went wrong"
      ? projectedError
      : undefined;
  return (
    <RecoveryState
      className={`relay-recording-problem${className ? ` ${className}` : ""}`}
      title={publicRecovery?.title ?? "Relay could not complete this request"}
      detail={publicRecovery?.detail ?? errorMessage(error)}
      recovery={publicRecovery?.recovery}
      layout={layout}
      action={
        onRetry && (recovery?.retryable ?? true) ? (
          <Button size="small" variant="secondary" onClick={onRetry} disabled={retrying}>
            <RotateCcw aria-hidden="true" />
            {retrying ? "Trying again…" : "Try again"}
          </Button>
        ) : undefined
      }
    />
  );
}

function recoveryCopy(
  recovery: ProductRecovery,
): Pick<ProductRecovery, "title" | "detail" | "recovery"> {
  if (recovery.code === "raw-evidence-recapture-required") {
    return {
      title: "Relay needs a fresh capture of the starting screen",
      detail: "This Test cannot run until its starting screen is captured again.",
      recovery: "Open the Test, record the starting screen again, then save it.",
    };
  }
  const combined = `${recovery.title} ${recovery.detail} ${recovery.recovery}`;
  if (
    /workflow|operation|expectedversion|appmap|targetid|profile id|lease|digest|binding|selector|xpath|raw accessibility|geometry/iu.test(
      combined,
    )
  ) {
    return {
      title: "Relay needs your attention",
      detail: errorMessage(new Error(combined)),
      recovery: recovery.retryable
        ? "Try again after checking the app, device, and Relay connection."
        : "Return to the Test and choose another available action.",
    };
  }
  return recovery;
}

export function targetLabel(target: {
  kind: "device" | "browser";
  platform: "android" | "ios" | "browser";
  targetId: string;
  name?: string;
  detail?: string;
}): { title: string; detail: string } {
  if (target.name?.trim()) {
    return { title: target.name.trim(), detail: target.detail?.trim() || "Ready" };
  }
  if (target.kind === "browser") {
    return { title: "Managed browser", detail: "Ready to record" };
  }
  if (target.platform === "ios") return { title: "iOS device", detail: "Ready to record" };
  return {
    title: /^emulator(?:-|$)/i.test(target.targetId) ? "Android emulator" : "Android device",
    detail: "Ready to record",
  };
}

/** @jsxImportSource react */
import { Skeleton } from "@relay/ui-react/components/skeleton";
import { Button } from "@relay/ui-react/components/button";
import { capturedSetupRecovery, projectError } from "@relay/product/errors";
import { Link } from "@tanstack/react-router";
import { CircleAlert, RotateCcw } from "lucide-react";
import type { ReactNode } from "react";
import { RecoveryState } from "../components/product-patterns";
import {
  recordingReviewDiagnostics,
  recordingReviewErrorCopy,
  type RecordingReviewOperation,
} from "./recording-review-error";
type ProductRecovery = {
  code?: string;
  action?: string;
  sourceCode?: string;
  httpStatus?: number;
  sourceStepId?: string;
  title: string;
  detail: string;
  recovery: string;
  retryable: boolean;
};

export function ReconnectLiveViewButton({
  disabled,
  onClick,
}: {
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <Button variant="secondary" disabled={disabled} onClick={onClick}>
      Reconnect live view
    </Button>
  );
}

export function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  if (/raw accessibility|immutable raw|offline geometry|raw-evidence/iu.test(message)) {
    return "Relay needs a fresh capture of the starting screen before this test can run.";
  }
  if (/target selection is ambiguous|choose one by id/iu.test(message)) {
    return "Choose one ready device or browser, then try again.";
  }
  if (/app map selection is ambiguous/iu.test(message)) {
    return "Choose the app that owns this test, then try again.";
  }
  if (/this test appears in more than one app/iu.test(message)) {
    return "This test appears in more than one app and cannot be opened safely.";
  }
  if (/no connected .+ target is ready|nothing is ready/iu.test(message)) {
    return "No device or managed browser is ready. Connect one, then try again.";
  }
  if (/failed to fetch|networkerror|connection (?:ended|failed|refused)/iu.test(message)) {
    return "Relay could not reach the local service. Check the connection, then try again.";
  }
  return "Relay could not complete this request. Try again, or return to the test.";
}

export function PageLoading({ label }: { label: string }) {
  return (
    <div className="mt-8 grid max-w-4xl gap-4" role="status" aria-live="polite">
      <span className="sr-only">{label}</span>
      <div className="grid max-w-sm gap-2" aria-hidden="true">
        <Skeleton className="h-4 w-[34%]" />
        <Skeleton className="h-3 w-[78%]" />
      </div>
      <div className="grid grid-cols-2 gap-2.5" aria-hidden="true">
        <Skeleton />
        <Skeleton />
      </div>
    </div>
  );
}

export function RefreshProblem({
  subject,
  onRetry,
  retrying = false,
}: {
  subject: string;
  onRetry: () => void;
  retrying?: boolean;
}) {
  return (
    <div
      role="status"
      className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-muted/30 px-4 py-3 text-sm"
    >
      <div className="min-w-0">
        <p className="font-medium">Couldn’t refresh {subject}</p>
        <p className="text-muted-foreground">
          Showing the last loaded information. It may be out of date.
        </p>
      </div>
      <Button variant="outline" size="sm" disabled={retrying} onClick={onRetry}>
        <RotateCcw aria-hidden="true" />
        {retrying ? "Refreshing…" : "Refresh"}
      </Button>
    </div>
  );
}

export function RecordingProblem({
  recovery,
  error,
  onRetry,
  retrying = false,
  checking = false,
  layout = "compact",
  className,
  action,
  operation = "step",
  reviewOperation,
  testContext,
}: {
  recovery?: ProductRecovery;
  error?: unknown;
  onRetry?: () => void;
  retrying?: boolean;
  checking?: boolean;
  layout?: "compact" | "centered";
  className?: string;
  action?: ReactNode;
  operation?: "step" | "run" | "replay" | "recording";
  reviewOperation?: RecordingReviewOperation;
  testContext?: { testId: string; appMapId?: string };
}) {
  if (!recovery && !error) return null;
  const statusOperation = reviewOperation
    ? reviewOperation === "replay" || recovery?.action === "replay"
      ? "replay"
      : "recording"
    : operation;
  if (recovery?.code === "mutation-outcome-unknown") {
    return (
      <div
        data-slot="recording-problem"
        className={`flex min-h-9 items-center justify-between gap-3 text-xs text-muted-foreground ${className ?? ""}`}
        role="status"
      >
        <span>
          {checking
            ? `Checking ${statusOperation} status…`
            : statusOperation === "replay"
              ? "Replay status needs checking. Your saved steps are safe."
              : statusOperation === "recording"
                ? "Recording status needs checking."
                : statusOperation === "run"
                  ? "Run status needs checking."
                  : "Step status needs checking."}
          {error && reviewOperation === "inspect"
            ? " Could not refresh the recording status."
            : null}
        </span>
        {action ??
          (!checking && onRetry ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={onRetry}
              disabled={retrying}
              title={
                statusOperation === "recording"
                  ? "Check the recording status. This does not send device input."
                  : statusOperation === "replay"
                    ? "Check the replay status. This does not repeat the recorded steps."
                    : statusOperation === "run"
                      ? "Check whether the run started. This does not start another run."
                      : "Check whether the step was saved. This does not repeat the device action."
              }
            >
              Check status
            </Button>
          ) : null)}
        {error && reviewOperation ? (
          <details className="text-xs text-muted-foreground">
            <summary className="cursor-pointer">Details</summary>
            <div className="mt-1 whitespace-pre-wrap">
              {recordingReviewDiagnostics(reviewOperation, error, recovery).join("\n")}
            </div>
          </details>
        ) : null}
      </div>
    );
  }
  const projectedError = error ? projectError(error) : undefined;
  const capturedSetup = capturedSetupRecovery(recovery ?? projectedError ?? {});
  const baseRecovery =
    capturedSetup ??
    (recovery
      ? recoveryCopy(recovery)
      : projectedError?.title !== "Something went wrong"
        ? projectedError
        : undefined);
  const publicRecovery =
    reviewOperation && !capturedSetup
      ? recordingReviewErrorCopy(reviewOperation, baseRecovery, error, recovery)
      : baseRecovery;
  const diagnostics = reviewOperation
    ? recordingReviewDiagnostics(reviewOperation, error, recovery)
    : undefined;
  if (layout === "compact" && recovery?.title === "Replay did not prove the reviewed recording") {
    return (
      <div
        role="alert"
        data-slot="recording-problem"
        className={`flex items-center gap-2 rounded-md bg-muted/40 px-3 py-2 text-sm ${className ?? ""}`}
      >
        <CircleAlert className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span>
          {publicRecovery?.detail ?? "The test stopped. Review the failed step, then run it again."}
        </span>
      </div>
    );
  }
  return (
    <RecoveryState
      className={`${layout === "centered" ? "m-0 w-full max-w-none flex-1 justify-center border-0" : "mt-7 max-w-2xl"}${className ? ` ${className}` : ""}`}
      title={publicRecovery?.title ?? "Relay could not complete this request"}
      detail={publicRecovery?.detail ?? errorMessage(error)}
      recovery={publicRecovery?.recovery}
      layout={layout}
      action={
        <>
          {capturedSetup ? (
            testContext ? (
              <Button
                nativeButton={false}
                size={layout === "centered" ? "default" : "sm"}
                variant="outline"
                render={
                  <Link
                    to="/tests/$testId"
                    params={{ testId: testContext.testId }}
                    search={{
                      ...(testContext.appMapId ? { app: testContext.appMapId } : {}),
                      ...(capturedSetup.sourceStepId ? { step: capturedSetup.sourceStepId } : {}),
                    }}
                  />
                }
              >
                {capturedSetup.sourceStepId ? "Review affected step" : "Review test"}
              </Button>
            ) : undefined
          ) : (
            (action ??
            (onRetry &&
            (reviewOperation ||
              (recovery?.retryable ?? (publicRecovery ? projectedError?.retryable : true))) ? (
              <Button
                size={layout === "centered" ? "default" : "sm"}
                variant="outline"
                onClick={onRetry}
                disabled={retrying}
              >
                <RotateCcw aria-hidden="true" />
                {reviewOperation ? "Check status" : retrying ? "Trying again…" : "Try again"}
              </Button>
            ) : undefined))
          )}
          {diagnostics ? (
            <details className="text-xs text-muted-foreground">
              <summary className="cursor-pointer">Details</summary>
              <div className="mt-1 whitespace-pre-wrap">{diagnostics.join("\n")}</div>
            </details>
          ) : null}
        </>
      }
    />
  );
}

function recoveryCopy(
  recovery: ProductRecovery,
): Pick<ProductRecovery, "title" | "detail" | "recovery"> {
  if (recovery.sourceCode === "local-service-transport") {
    return {
      title: "Relay is not connected",
      detail:
        "Relay could not refresh this recording because the local service could not be reached.",
      recovery:
        "Check the Relay connection, then check status. This check did not change your recording.",
    };
  }
  if (
    /Return the device to the recorded source screen|Navigate the device to .+ before replaying/iu.test(
      recovery.detail,
    )
  ) {
    return {
      title: "Starting screen unavailable",
      detail: "Open the starting screen in the app, then run the test again.",
      recovery: "",
    };
  }
  if (recovery.sourceCode === "raw-evidence-variant-recapture-required") {
    return {
      title: "Saved controls need review",
      detail:
        "This screen capture does not contain every control the test expects. Review the steps before running again.",
      recovery: "",
    };
  }
  if (/Relay restarted during device capture/u.test(recovery.detail)) {
    return {
      title: "Recording stopped when Relay restarted",
      detail: "Your steps are saved. Choose Review saved steps to open them.",
      recovery: "",
    };
  }
  if (recovery.code === "raw-evidence-recapture-required") {
    return {
      title: "Relay needs a fresh capture of the starting screen",
      detail: "This test cannot run until its starting screen is captured again.",
      recovery: "Open the test, record the starting screen again, then save it.",
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
        : "Return to the test and choose another available action.",
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
    return { title: "Managed browser", detail: "Browser profile unavailable" };
  }
  if (target.platform === "ios") return { title: "iOS device", detail: "Ready to record" };
  return {
    title: /^emulator(?:-|$)/i.test(target.targetId) ? "Android emulator" : "Android device",
    detail: "Ready to record",
  };
}

export function liveIssueMessage(message: string): string {
  const missingDevice = /^(Android|iOS) device not available(?::|$)/iu.exec(message);
  if (missingDevice) return `Reconnect your ${missingDevice[1]} device to continue.`;
  if (
    /packet|metadata|content type|transport marker|canvas context|codec|decode|base64|targetid|operation/iu.test(
      message,
    )
  ) {
    return "Relay could not show the live view. Reconnect, then try again.";
  }
  return message;
}

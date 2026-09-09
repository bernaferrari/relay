/** @jsxImportSource react */
import { Skeleton } from "@relay/ui-react/components/skeleton";
import { Button } from "@relay/ui-react/components/button";
import { projectError } from "@relay/product/errors";
import { RotateCcw } from "lucide-react";
import type { ReactNode } from "react";
import { RecoveryState } from "../components/product-patterns";
type ProductRecovery = {
  code?: string;
  sourceCode?: string;
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
    <div className="mt-[34px] grid max-w-[848px] gap-[18px]" role="status" aria-live="polite">
      <span className="relay-visually-hidden sr-only">{label}</span>
      <div className="grid max-w-[400px] gap-2" aria-hidden="true">
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

export function RecordingProblem({
  recovery,
  error,
  onRetry,
  retrying = false,
  checking = false,
  layout = "compact",
  className,
  action,
}: {
  recovery?: ProductRecovery;
  error?: unknown;
  onRetry?: () => void;
  retrying?: boolean;
  checking?: boolean;
  layout?: "compact" | "centered";
  className?: string;
  action?: ReactNode;
}) {
  if (!recovery && !error) return null;
  if (recovery?.code === "mutation-outcome-unknown") {
    return (
      <div
        className={`relay-recording-problem flex min-h-9 items-center justify-between gap-3 text-xs text-muted-foreground ${className ?? ""}`}
        role="status"
      >
        <span>{checking ? "Checking step status…" : "Step status needs checking."}</span>
        {!checking && onRetry ? (
          <Button
            size="sm"
            variant="ghost"
            onClick={onRetry}
            disabled={retrying}
            title="Check whether the step was saved. This does not repeat the device action."
          >
            Check status
          </Button>
        ) : null}
      </div>
    );
  }
  const projectedError = error ? projectError(error) : undefined;
  const publicRecovery = recovery
    ? recoveryCopy(recovery)
    : projectedError?.title !== "Something went wrong"
      ? projectedError
      : undefined;
  return (
    <RecoveryState
      className={`relay-recording-problem ${layout === "centered" ? "m-0 w-full max-w-none flex-1 justify-center border-0" : "mt-7 max-w-[640px]"}${className ? ` ${className}` : ""}`}
      title={publicRecovery?.title ?? "Relay could not complete this request"}
      detail={publicRecovery?.detail ?? errorMessage(error)}
      recovery={publicRecovery?.recovery}
      layout={layout}
      action={
        action ??
        (onRetry && (recovery?.retryable ?? true) ? (
          <Button
            size={layout === "centered" ? "default" : "sm"}
            variant={layout === "centered" ? "default" : "outline"}
            onClick={onRetry}
            disabled={retrying}
          >
            <RotateCcw aria-hidden="true" />
            {retrying ? "Trying again…" : "Try again"}
          </Button>
        ) : undefined)
      }
    />
  );
}

function recoveryCopy(
  recovery: ProductRecovery,
): Pick<ProductRecovery, "title" | "detail" | "recovery"> {
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
    return { title: "Managed browser", detail: "Browser profile unavailable" };
  }
  if (target.platform === "ios") return { title: "iOS device", detail: "Ready to record" };
  return {
    title: /^emulator(?:-|$)/i.test(target.targetId) ? "Android emulator" : "Android device",
    detail: "Ready to record",
  };
}

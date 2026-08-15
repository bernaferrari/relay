import type { ScrollSurfaceCapturePolicy } from "@relay/protocol";
import { cn } from "../lib/cn";
import { Icon } from "./icon";

export function ScrollSurfaceCaptureAction(props: {
  busy: boolean;
  disabledReason?: string;
  policy?: ScrollSurfaceCapturePolicy;
  hasSurface: boolean;
  onCapture: () => void;
}) {
  const recommended = () =>
    props.policy?.captureMode === "full-surface" && props.policy.source === "recommended";
  const label = () => {
    if (props.busy) return "Capturing full surface…";
    if (props.hasSurface) return "Recapture full surface";
    return "Capture full surface";
  };

  return (
    <button
      type="button"
      data-scroll-surface-capture
      data-recommended={recommended() ? "true" : undefined}
      class={cn(
        "col-span-2 flex min-h-11 w-full touch-manipulation items-center justify-center gap-2 rounded-[8px] border px-3 text-[10.5px] font-medium outline-none transition-[background-color,border-color,color,transform] duration-150 focus-visible:ring-2 focus-visible:ring-[var(--border-focus)] active:scale-[0.96] disabled:cursor-not-allowed disabled:active:scale-100 motion-reduce:active:scale-100",
        recommended()
          ? "border-[var(--border-focus)] bg-[var(--product-accent-soft)] text-[var(--text-interactive-base)]"
          : "border-[var(--border-weak-base)] bg-[var(--surface-base)] text-[var(--text-strong)]",
        "disabled:border-[var(--border-weak-base)] disabled:bg-[var(--surface-base)] disabled:text-[var(--text-weaker)]",
      )}
      disabled={props.busy || Boolean(props.disabledReason)}
      aria-busy={props.busy}
      aria-describedby={props.disabledReason ? "scroll-surface-capture-status" : undefined}
      onClick={props.onCapture}
    >
      <Icon
        name={props.busy ? "refresh" : "camera"}
        size={12}
        class={props.busy ? "animate-spin motion-reduce:animate-none" : undefined}
      />
      <span>{label()}</span>
      {recommended() ? (
        <span class="rounded-full bg-[var(--text-interactive-base)] px-1.5 py-0.5 text-[8px] font-semibold text-[var(--background-base)]">
          Recommended
        </span>
      ) : null}
    </button>
  );
}

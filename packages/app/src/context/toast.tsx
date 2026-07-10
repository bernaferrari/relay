import { createSignal, For, onMount, onCleanup, type JSX } from "solid-js";
import { createSimpleContext } from "@grok-device/ui/context/helper";
import { Icon, type IconName } from "../components/icon";
import { cn } from "../lib/cn";

export type ToastTone = "info" | "success" | "error" | "warning";
type Toast = { id: number; text: string; tone: ToastTone };

/**
 * Decoupled toast queue. Anything can fire a toast via:
 *   window.dispatchEvent(new CustomEvent("stage:toast", { detail: { text, tone } }))
 * or from inside the provider via useToast().push(...).
 * This keeps the toast system free of import cycles (e.g. the server/command contexts).
 * Legacy `specimen:toast` is still accepted for one release.
 */
export const { use: useToast, provider: ToastProvider } = createSimpleContext({
  name: "Toast",
  gate: false,
  init: () => {
    const [toasts, setToasts] = createSignal<Toast[]>([]);
    let seq = 0;

    function push(text: string, tone: ToastTone = "info", ttl = 4200): number {
      const id = ++seq;
      setToasts((prev) => [...prev.slice(-3), { id, text: text.trim(), tone }]);
      if (ttl > 0) setTimeout(() => dismiss(id), ttl);
      return id;
    }
    function dismiss(id: number) {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }
    return { toasts, push, dismiss };
  },
});

const TONE_ICON: Record<ToastTone, IconName> = {
  info: "info",
  success: "check",
  error: "alert",
  warning: "alert",
};

function toneCls(tone: ToastTone): string {
  if (tone === "success")
    return "border-border-success-base/40 bg-surface-success-weak text-icon-success-base";
  if (tone === "error")
    return "border-border-critical-base/40 bg-surface-critical-weak text-icon-critical-base";
  if (tone === "warning")
    return "border-border-warning-base/40 bg-surface-warning-weak text-icon-warning-base";
  return "border-border-weak-base bg-surface-raised-stronger-non-alpha text-text-strong";
}

const TOAST_EVENTS = ["stage:toast", "specimen:toast"] as const;

export function Toaster(): JSX.Element {
  const t = useToast();

  // bridge the decoupled CustomEvent API into the queue
  const onToast = (e: Event) => {
    const detail = (e as CustomEvent).detail as
      | { text?: string; tone?: ToastTone; ttl?: number }
      | undefined;
    if (detail?.text) t.push(detail.text, detail.tone ?? "info", detail.ttl);
  };
  onMount(() => {
    for (const name of TOAST_EVENTS) window.addEventListener(name, onToast);
  });
  onCleanup(() => {
    for (const name of TOAST_EVENTS) window.removeEventListener(name, onToast);
  });

  return (
    <div
      class="pointer-events-none fixed right-4 bottom-4 z-[200] flex w-[min(360px,calc(100vw-2rem))] flex-col-reverse gap-2"
      role="region"
      aria-label="Notifications"
      aria-live="polite"
    >
      <For each={t.toasts()}>
        {(toast) => (
          <div
            class={cn(
              "ui-pop pointer-events-auto flex items-start gap-2.5 rounded-xl border px-3.5 py-3 shadow-md",
              "origin-bottom-right",
              toneCls(toast.tone),
            )}
            role={toast.tone === "error" ? "alert" : "status"}
          >
            <span class="mt-0.5 grid shrink-0 place-items-center" aria-hidden="true">
              <Icon name={TONE_ICON[toast.tone]} size={15} />
            </span>
            <span class="min-w-0 flex-1 text-12-medium leading-snug font-medium text-current">
              {toast.text}
            </span>
            <button
              type="button"
              class="grid size-6 shrink-0 place-items-center rounded-md text-current opacity-55 transition-[background-color,opacity,transform] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] hover:bg-surface-base-hover hover:opacity-100"
              aria-label="Dismiss notification"
              onClick={() => t.dismiss(toast.id)}
            >
              <Icon name="x" size={13} />
            </button>
          </div>
        )}
      </For>
    </div>
  );
}

/** Fire a toast from anywhere (no hook/import-cycle needed). */
export function toast(text: string, tone: ToastTone = "info", ttl?: number): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("stage:toast", { detail: { text, tone, ttl } }));
  }
}

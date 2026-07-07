import { createSignal, For, onMount, onCleanup, type JSX } from "solid-js";
import { createSimpleContext } from "@grok-device/ui/context/helper";
import { Icon, type IconName } from "../components/icon";

export type ToastTone = "info" | "success" | "error" | "warning";
type Toast = { id: number; text: string; tone: ToastTone };

/**
 * Decoupled toast queue. Anything can fire a toast via:
 *   window.dispatchEvent(new CustomEvent("specimen:toast", { detail: { text, tone } }))
 * or from inside the provider via useToast().push(...).
 * This keeps the toast system free of import cycles (e.g. the server/command contexts).
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

export function Toaster(): JSX.Element {
  const t = useToast();

  // bridge the decoupled CustomEvent API into the queue
  const onToast = (e: Event) => {
    const detail = (e as CustomEvent).detail as
      | { text?: string; tone?: ToastTone; ttl?: number }
      | undefined;
    if (detail?.text) t.push(detail.text, detail.tone ?? "info", detail.ttl);
  };
  onMount(() => window.addEventListener("specimen:toast", onToast));
  onCleanup(() => window.removeEventListener("specimen:toast", onToast));

  return (
    <div class="toaster" role="region" aria-label="Notifications" aria-live="polite">
      <For each={t.toasts()}>
        {(toast) => (
          <div class="toast" classList={{ [`toast--${toast.tone}`]: true }} role="status">
            <span class="toast__icon" aria-hidden="true">
              <Icon name={TONE_ICON[toast.tone]} size={15} />
            </span>
            <span class="toast__text">{toast.text}</span>
            <button
              type="button"
              class="toast__close"
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
    window.dispatchEvent(new CustomEvent("specimen:toast", { detail: { text, tone, ttl } }));
  }
}

import { lazy, onCleanup, onMount, type JSX } from "solid-js";
import { useTheme } from "@relay/ui/theme/context";

export type ToastTone = "info" | "success" | "error" | "warning";

const TOAST_EVENT = "stage:toast";
type SonnerModule = typeof import("solid-sonner");
let sonner: Promise<SonnerModule> | undefined;
type PendingToast = { text: string; tone: ToastTone; ttl?: number };
let pending: PendingToast[] = [];
let publish: ((entry: PendingToast) => void) | undefined;

const loadSonner = () => (sonner ??= import("solid-sonner"));
const SonnerToaster = lazy(async () => ({ default: (await loadSonner()).Toaster }));

function showToast(text: string, tone: ToastTone, ttl?: number): void {
  if (!text) return;
  const entry = { text, tone, ...(ttl === undefined ? {} : { ttl }) };
  if (publish) publish(entry);
  else if (typeof window === "object") pending = [...pending.slice(-2), entry];
}

/**
 * Relay uses Sonner's standard toast presentation. The event bridge remains so
 * low-level contexts can report failures without importing product UI modules.
 */
export function Toaster(): JSX.Element {
  const theme = useTheme();

  const onToast = (event: Event) => {
    const detail = (event as CustomEvent).detail as
      | { text?: string; tone?: ToastTone; ttl?: number }
      | undefined;
    const text = detail?.text?.trim();
    if (text) showToast(text, detail?.tone ?? "info", detail?.ttl);
  };

  onMount(() => {
    window.addEventListener(TOAST_EVENT, onToast);
    void loadSonner().then(({ toast }) => {
      publish = ({ text, tone, ttl }) => {
        const options = {
          id: `${tone}:${text}`,
          ...(ttl === undefined ? {} : { duration: ttl }),
        };
        if (tone === "success") toast.success(text, options);
        else if (tone === "error") toast.error(text, options);
        else if (tone === "warning") toast.warning(text, options);
        else toast.info(text, options);
      };
      const queued = pending;
      pending = [];
      queued.forEach((entry) => publish?.(entry));
    });
  });
  onCleanup(() => window.removeEventListener(TOAST_EVENT, onToast));

  return (
    <SonnerToaster
      theme={theme.mode()}
      position="bottom-left"
      visibleToasts={1}
      containerAriaLabel="Notifications"
    />
  );
}

/** Fire a standard Sonner toast from anywhere in the product UI. */
export function toast(text: string, tone: ToastTone = "info", ttl?: number): void {
  showToast(text.trim(), tone, ttl);
}

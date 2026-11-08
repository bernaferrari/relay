/** @jsxImportSource react */
import { Usb } from "lucide-react";

/** A tiny drawing of the hardware so the grid reads at a glance. */
export function DeviceSilhouette({ kind }: { kind: "phone" | "tablet" | "window" | "android" }) {
  if (kind === "android") {
    return (
      <svg
        data-slot="android-device-icon"
        viewBox="0 0 24 24"
        className="size-8 text-foreground/70"
        aria-hidden="true"
      >
        <path
          d="m7 7-2-3m12 3 2-3"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
        <path d="M2 18a10 10 0 0 1 20 0Z" fill="currentColor" />
        <circle cx="7.5" cy="14" r="1" className="fill-stage" />
        <circle cx="16.5" cy="14" r="1" className="fill-stage" />
      </svg>
    );
  }
  if (kind === "window") {
    return (
      <span className="flex h-7 w-9 flex-col overflow-hidden rounded-md border-2 border-foreground/70 bg-card">
        <span className="h-1.5 border-b border-foreground/40 bg-foreground/10" />
      </span>
    );
  }
  return (
    <span
      className={`relative rounded-md border-2 border-foreground/70 bg-card ${kind === "tablet" ? "h-8 w-6.5" : "h-8 w-4.5"}`}
    >
      <span className="absolute top-0.5 left-1/2 h-0.5 w-1.5 -translate-x-1/2 rounded-full bg-foreground/60" />
    </span>
  );
}

/** First-run help where a phone would appear: what to do, not an empty grid. */
export function ConnectDeviceHint({ canStartEmulator }: { canStartEmulator: boolean }) {
  return (
    <section aria-label="Phones and tablets">
      <div className="flex min-h-9 items-center px-1 pb-2">
        <h2 className="text-sm font-semibold">Phones and tablets</h2>
      </div>
      <div className="flex items-center gap-3.5 rounded-xl border border-dashed border-border p-4">
        <span
          className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground"
          aria-hidden="true"
        >
          <Usb className="size-5" />
        </span>
        <span className="grid gap-0.5 text-sm">
          <strong className="font-medium">Connect a phone or tablet</strong>
          <span className="text-muted-foreground">
            Plug it in by USB and unlock it. Relay finds it automatically.
            {canStartEmulator ? " Or start an emulator from Not running below." : ""}
          </span>
        </span>
      </div>
    </section>
  );
}

/** @jsxImportSource react */
import { Button } from "@relay/ui-react/components/button";
import { Link } from "@tanstack/react-router";
import { ChevronRight, Monitor, Smartphone } from "lucide-react";
import { devicePlatformLabel } from "../data/device-label";
import type { ProductDevice } from "../data/device-product-service";

export function LiveDevices({ devices }: { devices: readonly ProductDevice[] }) {
  const available = [...devices]
    .sort(
      (a, b) =>
        Number(b.status === "ready") - Number(a.status === "ready") || a.name.localeCompare(b.name),
    )
    .slice(0, 4);
  return (
    <section className="mb-8" aria-labelledby="live-devices-title">
      <div className="mb-3 flex items-center justify-between gap-4">
        <h2 id="live-devices-title" className="text-sm font-semibold">
          Open a device
        </h2>
        <Button nativeButton={false} variant="ghost" size="sm" render={<Link to="/devices" />}>
          View all devices
        </Button>
      </div>
      {available.length ? (
        <ul className="grid list-none gap-3 p-0 sm:grid-cols-2">
          {available.map((device) => {
            const Icon = device.platform === "browser" ? Monitor : Smartphone;
            return (
              <li key={device.id}>
                <Link
                  to="/devices/$deviceId"
                  params={{ deviceId: device.id }}
                  className="flex min-h-24 items-center gap-4 rounded-xl border border-border bg-card p-4 transition-colors hover:bg-surface-raised-strong-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-text-strong"
                >
                  <span className="grid size-11 shrink-0 place-items-center rounded-lg bg-surface-base text-text-weak">
                    <Icon className="size-5" aria-hidden="true" />
                  </span>
                  <span className="grid min-w-0 flex-1 gap-1.5">
                    <strong className="truncate text-sm font-semibold">{device.name}</strong>
                    <span className="flex items-center gap-2 text-xs text-text-weak">
                      <span
                        aria-hidden="true"
                        className={`size-1.5 rounded-full ${device.status === "ready" ? "bg-emerald-500" : device.status === "needs-attention" ? "bg-amber-500" : "bg-text-weaker"}`}
                      />
                      {device.status === "ready"
                        ? "Connected"
                        : device.status === "needs-attention"
                          ? "Needs attention"
                          : "Virtual device"}
                      {device.osVersion ? ` · ${devicePlatformLabel(device)}` : ""}
                    </span>
                  </span>
                  <ChevronRight className="size-4 shrink-0 text-text-weaker" aria-hidden="true" />
                </Link>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="rounded-xl border border-dashed border-border p-5 text-sm text-text-weak">
          Connect a device or configure a browser in Devices to begin.
        </p>
      )}
    </section>
  );
}

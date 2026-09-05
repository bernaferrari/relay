/** @jsxImportSource react */
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
      <div className="mb-2 flex min-h-7 items-center justify-between gap-4">
        <h2 id="live-devices-title" className="text-[13px] font-medium text-muted-foreground">
          Devices
        </h2>
        <Link
          className="text-[13px] text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          to="/devices"
        >
          View all
        </Link>
      </div>
      {available.length ? (
        <ul className="m-0 list-none overflow-hidden rounded-xl border border-border bg-card p-0">
          {available.map((device) => {
            const Icon = device.platform === "browser" ? Monitor : Smartphone;
            return (
              <li className="border-b border-border last:border-b-0" key={device.id}>
                <Link
                  to="/devices/$deviceId"
                  params={{ deviceId: device.id }}
                  className="flex min-h-14 items-center gap-3 px-3 py-2.5 transition-colors hover:bg-muted/40 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring"
                >
                  <span className="grid size-8 shrink-0 place-items-center rounded-md border border-border text-muted-foreground">
                    <Icon className="size-3.5" aria-hidden="true" />
                  </span>
                  <span className="grid min-w-0 flex-1 gap-0.5">
                    <strong className="truncate text-[13px] font-medium">{device.name}</strong>
                    <span className="truncate text-[12px] text-muted-foreground">
                      {device.status === "ready"
                        ? "Connected"
                        : device.status === "needs-attention"
                          ? "Needs attention"
                          : "Virtual"}
                      {device.osVersion ? ` · ${devicePlatformLabel(device)}` : ""}
                    </span>
                  </span>
                  <ChevronRight
                    className="size-4 shrink-0 text-muted-foreground"
                    aria-hidden="true"
                  />
                </Link>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-[13px] text-muted-foreground">
          Connect a device or open a browser, then come back here.
        </p>
      )}
    </section>
  );
}

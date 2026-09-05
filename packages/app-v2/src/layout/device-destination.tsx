/** @jsxImportSource react */
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@relay/ui-react/components/dropdown-menu";
import { useQuery } from "@tanstack/react-query";
import { useRouter, useRouteContext } from "@tanstack/react-router";
import { ChevronDown, MonitorSmartphone } from "lucide-react";
import { deviceQueryKeys } from "../data/device-product-service";
import {
  destinationItems,
  destinationStatusLabel,
  summarizeDestinations,
} from "./destination-summary";

export function DeviceDestinationButton() {
  const router = useRouter();
  const { deviceService } = useRouteContext({ from: "__root__" });
  const devices = useQuery({
    queryKey: deviceQueryKeys.devices,
    queryFn: () => deviceService.list(),
    staleTime: 5_000,
    refetchInterval: 15_000,
    retry: false,
  });
  const summary = summarizeDestinations({
    devices: devices.data,
    status: devices.isError ? "error" : devices.isPending ? "pending" : "success",
  });
  const items = destinationItems(devices.data ?? []);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="relay-destination-trigger relay-electron-no-drag [-webkit-app-region:no-drag] inline-flex h-7 max-w-[12.5rem] items-center gap-1 rounded-[min(var(--radius-md),12px)] px-2.5 text-[0.8rem] text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-[var(--relay-focus-ring)] focus-visible:outline-offset-2"
        aria-label={`Device or browser: ${summary.label}`}
      >
        <MonitorSmartphone className="size-3.5 shrink-0" aria-hidden="true" />
        <span className="min-w-0 truncate">{summary.label}</span>
        <ChevronDown className="size-3.5 shrink-0 opacity-70" aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={6} className="min-w-64 w-72">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="relay-menu-label block px-2.5 pb-1.5 pt-[7px] text-[10px] font-semibold uppercase leading-[1.2] tracking-[0.06em] text-[var(--text-weaker)]">
            Device or browser
          </DropdownMenuLabel>
          {items.length ? (
            items.map((item) => (
              <DropdownMenuItem
                key={item.id}
                className="relay-menu-item focus-visible:outline-2 focus-visible:outline-[var(--relay-focus-ring)] focus-visible:outline-offset-2 flex min-h-10 items-start justify-between gap-4"
                onClick={() =>
                  router.history.push(
                    item.platform === "browser"
                      ? `/environments/${item.id}`
                      : `/devices/${item.id}`,
                  )
                }
              >
                <span className="min-w-0">
                  <span className="block truncate">{item.name}</span>
                  <span className="block truncate text-[11px] text-muted-foreground">
                    {item.detail}
                  </span>
                </span>
                <span className="shrink-0 pt-0.5 text-[11px] text-muted-foreground">
                  {destinationStatusLabel(item.status)}
                </span>
              </DropdownMenuItem>
            ))
          ) : (
            <DropdownMenuItem className="relay-menu-note text-xs text-muted-foreground" disabled>
              {summary.detail}
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator className="relay-menu-separator my-2 ml-1.5 mr-1.5 h-px bg-[var(--border-weak-base)]" />
          <DropdownMenuItem
            className="relay-menu-item focus-visible:outline-2 focus-visible:outline-[var(--relay-focus-ring)] focus-visible:outline-offset-2"
            onClick={() => router.history.push("/devices")}
          >
            All Devices
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

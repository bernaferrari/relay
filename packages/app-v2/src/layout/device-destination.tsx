/** @jsxImportSource react */
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
} from "@relay/ui-react/components/dropdown-menu";
import { useQuery } from "@tanstack/react-query";
import { useRouter, useRouteContext } from "@tanstack/react-router";
import {
  Check,
  ChevronDown,
  Globe,
  MonitorSmartphone,
  RefreshCw,
  Settings2,
  Smartphone,
} from "lucide-react";
import { deviceQueryKeys, type ProductDevice } from "../data/device-product-service";
import {
  WORKSPACE_DESTINATION_KEY,
  destinationRunTargetId,
  parseWorkspaceDestination,
  summarizeDestinations,
  workspaceDestinationQueryKey,
} from "./destination-summary";

const groups = ["Devices", "Android emulators", "iOS simulators", "Browsers"] as const;
function groupFor(device: ProductDevice): (typeof groups)[number] {
  if (device.platform === "browser") return "Browsers";
  if (/simulator/i.test(device.kind ?? "")) return "iOS simulators";
  if (/emulator/i.test(device.kind ?? "")) return "Android emulators";
  return "Devices";
}
function versionLabel(device: ProductDevice): string | undefined {
  if (!device.osVersion) return undefined;
  return `${device.platform === "android" ? "Android" : device.platform === "ios" ? "iOS" : "Version"} ${device.osVersion}`;
}
const rowClass = "min-h-8 gap-2.5 px-2 text-[13px]";

export function DeviceDestinationButton() {
  const router = useRouter();
  const { deviceService, platform, queryClient } = useRouteContext({ from: "__root__" });
  const devices = useQuery({
    queryKey: deviceQueryKeys.devices,
    queryFn: () => deviceService.list(),
    staleTime: 5_000,
    refetchInterval: 15_000,
    retry: false,
  });
  const selected = useQuery({
    queryKey: workspaceDestinationQueryKey,
    queryFn: async () =>
      parseWorkspaceDestination(await platform.storage.get(WORKSPACE_DESTINATION_KEY)) ?? null,
    staleTime: Infinity,
  });
  const summary = summarizeDestinations({
    devices: devices.data,
    status: devices.isError ? "error" : devices.isPending ? "pending" : "success",
  });
  const available = (devices.isError ? [] : (devices.data ?? [])).filter(
    (item) => item.status !== "needs-attention",
  );
  const unavailable = (devices.isError ? [] : (devices.data ?? [])).filter(
    (item) => item.status === "needs-attention",
  );
  const current = available.find(
    (item) => destinationRunTargetId(item) === selected.data?.targetId,
  );
  const label = current?.name ?? summary.label;
  function select(device: ProductDevice) {
    const next = { targetId: destinationRunTargetId(device) };
    queryClient.setQueryData(workspaceDestinationQueryKey, next);
    void platform.storage.set(WORKSPACE_DESTINATION_KEY, JSON.stringify(next));
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="relay-destination-trigger relay-electron-no-drag [-webkit-app-region:no-drag] inline-flex h-7 max-w-[12.5rem] items-center gap-1 rounded-md px-2.5 text-[13px] text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-[var(--relay-focus-ring)] focus-visible:outline-offset-2"
        aria-label={`Device or browser: ${label}`}
      >
        <MonitorSmartphone className="size-3.5 shrink-0" aria-hidden="true" />
        <span className="min-w-0 truncate">{label}</span>
        <ChevronDown className="size-3 shrink-0 opacity-60" aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        sideOffset={8}
        className="w-80 max-h-[min(480px,var(--available-height))] max-w-[calc(100vw-24px)] overflow-y-auto p-1.5"
      >
        <div className="max-h-[min(320px,50dvh)] overflow-y-auto overscroll-contain">
          {groups.map((group) => {
            const members = available.filter((device) => groupFor(device) === group);
            if (!members.length) return null;
            return (
              <DropdownMenuGroup key={group}>
                <DropdownMenuLabel className="px-2 pb-1 pt-2 text-[11px] font-medium">
                  {group}
                </DropdownMenuLabel>
                {members.map((device) => {
                  const Icon = device.platform === "browser" ? Globe : Smartphone;
                  const isSelected = current?.id === device.id;
                  return (
                    <DropdownMenuItem
                      key={device.id}
                      className={rowClass}
                      onClick={() => select(device)}
                      aria-label={`${device.name}${isSelected ? ", selected" : ""}`}
                    >
                      <Icon className="size-3.5 text-muted-foreground" aria-hidden="true" />
                      <span className="min-w-0 flex-1 truncate" title={device.name}>
                        {device.name}
                      </span>
                      {device.osVersion ? (
                        <span className="text-[11px] text-muted-foreground">
                          {versionLabel(device)}
                        </span>
                      ) : null}
                      <span className="w-3.5">
                        {isSelected ? <Check className="size-3.5" aria-hidden="true" /> : null}
                      </span>
                    </DropdownMenuItem>
                  );
                })}
              </DropdownMenuGroup>
            );
          })}
          {!available.length ? (
            <p className="px-2 py-3 text-xs text-muted-foreground">
              {devices.isError
                ? "Couldn’t check connected devices."
                : devices.isPending
                  ? "Checking devices…"
                  : "No connected devices. Start a simulator or connect a phone."}
            </p>
          ) : null}
        </div>
        {unavailable.length ? (
          <>
            <DropdownMenuSeparator className="my-1.5" />
            {groups.map((group) => {
              const members = unavailable.filter((device) => groupFor(device) === group);
              if (!members.length) return null;
              return (
                <DropdownMenuSub key={group}>
                  <DropdownMenuSubTrigger className={rowClass}>
                    <span className="flex-1">{group}</span>
                    <span className="text-[11px] text-muted-foreground">{members.length}</span>
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent className="w-80 max-h-[min(360px,60dvh)] overflow-y-auto">
                    <DropdownMenuGroup>
                      <DropdownMenuLabel>Choose one to open its setup</DropdownMenuLabel>
                      {members.map((device) => (
                        <DropdownMenuItem
                          key={device.id}
                          className={rowClass}
                          onClick={() =>
                            router.history.push(`/devices/${encodeURIComponent(device.id)}`)
                          }
                        >
                          <span className="min-w-0 flex-1 truncate">{device.name}</span>
                          <span className="text-[11px] text-muted-foreground">
                            {versionLabel(device) ??
                              (members.filter((other) => other.name === device.name).length > 1
                                ? device.serial.slice(-6)
                                : "")}
                          </span>
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuGroup>
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
              );
            })}
          </>
        ) : null}
        <DropdownMenuSeparator className="my-1.5" />
        <DropdownMenuItem
          className={rowClass}
          disabled={devices.isFetching}
          onClick={() => void devices.refetch()}
        >
          <RefreshCw className="size-3.5 text-muted-foreground" aria-hidden="true" />
          Check again
        </DropdownMenuItem>
        <DropdownMenuItem className={rowClass} onClick={() => router.history.push("/devices")}>
          <Settings2 className="size-3.5 text-muted-foreground" aria-hidden="true" />
          Manage devices
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

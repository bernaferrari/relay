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
import { useState } from "react";
import { Input } from "@relay/ui-react/components/input";
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
import { isGoalScratchTarget } from "../data/target-presentation";
import {
  browserCatalogQueryKey,
  isLoopbackBrowserUrl,
  mergeDeviceCatalog,
} from "../data/device-catalog-presentation";
import {
  WORKSPACE_DESTINATION_KEY,
  destinationRunTargetId,
  parseWorkspaceDestination,
  summarizeDestinations,
  workspaceDestinationQueryKey,
} from "./destination-summary";

const groups = [
  "Devices",
  "Android emulators",
  "iOS simulators",
  "Browsers",
  "Local browsers",
] as const;
function groupFor(device: ProductDevice): (typeof groups)[number] {
  if (device.platform === "browser")
    return isLoopbackBrowserUrl(device.browserUrl) ? "Local browsers" : "Browsers";
  if (/simulator/i.test(device.kind ?? "")) return "iOS simulators";
  if (/emulator/i.test(device.kind ?? "")) return "Android emulators";
  return "Devices";
}
function versionLabel(device: ProductDevice): string | undefined {
  if (!device.osVersion) return undefined;
  return `${device.platform === "android" ? "Android" : device.platform === "ios" ? "iOS" : "Version"} ${device.osVersion}`;
}
const rowClass = "min-h-8 gap-2.5 px-2 text-sm";

export function DeviceDestinationButton({
  label: triggerLabel,
  onSelect,
}: { label?: string; onSelect?(device: ProductDevice): void } = {}) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const { deviceService, browserSpacesService, platform, queryClient } = useRouteContext({
    from: "__root__",
  });
  const spaces = useQuery({
    queryKey: browserCatalogQueryKey,
    queryFn: () => browserSpacesService.listSpaces(),
    staleTime: 30_000,
    retry: false,
  });
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
  const knownDevices = mergeDeviceCatalog(devices.data, spaces.data).filter(
    (device) => device.platform !== "browser" || !isGoalScratchTarget(device.id),
  );
  const summary = summarizeDestinations({
    devices: knownDevices,
    status: devices.isError ? "error" : devices.isPending ? "pending" : "success",
  });
  // A saved browser configuration remains selectable after a refresh fails.
  // Cached hardware readiness does not establish a current connection.
  const available = knownDevices.filter(
    (item) =>
      item.status !== "needs-attention" &&
      (!devices.isError || (item.platform === "browser" && item.status === "virtual")),
  );
  const unavailable = knownDevices.filter(
    (item) => item.status === "needs-attention" || (devices.isError && item.platform !== "browser"),
  );
  const current = available.find(
    (item) => destinationRunTargetId(item) === selected.data?.targetId,
  );
  const label = current?.name ?? "Choose device";
  const query = search.trim().toLocaleLowerCase();
  const localBrowsers = available.filter((device) => groupFor(device) === "Local browsers");
  const selectedLocalBrowser = current && groupFor(current) === "Local browsers" ? current : null;
  const otherLocalBrowsers = localBrowsers.filter((device) => device.id !== current?.id);
  const matches = (device: ProductDevice) =>
    !query ||
    `${device.name} ${device.id} ${device.serial} ${device.browserUrl ?? ""} ${device.kind ?? ""}`
      .toLocaleLowerCase()
      .includes(query);
  function select(device: ProductDevice) {
    onSelect?.(device);
    const next = { targetId: destinationRunTargetId(device) };
    queryClient.setQueryData(workspaceDestinationQueryKey, next);
    void platform.storage.set(WORKSPACE_DESTINATION_KEY, JSON.stringify(next));
  }
  function destinationItem(device: ProductDevice) {
    const Icon = device.platform === "browser" ? Globe : Smartphone;
    const isSelected = current?.id === device.id;
    return (
      <DropdownMenuItem
        key={device.id}
        className={rowClass}
        onClick={() => select(device)}
        closeOnClick
        aria-label={`${device.name}${isSelected ? ", selected" : ""}`}
      >
        <Icon className="size-3.5 text-muted-foreground" aria-hidden="true" />
        <span
          className="min-w-0 flex-1 truncate"
          title={device.browserUrl ? `${device.name}\n${device.browserUrl}` : device.name}
        >
          {device.name}
        </span>
        {device.osVersion ? (
          <span className="text-xs text-muted-foreground">{versionLabel(device)}</span>
        ) : null}
        <span className="w-3.5">
          {isSelected ? <Check className="size-3.5" aria-hidden="true" /> : null}
        </span>
      </DropdownMenuItem>
    );
  }
  return (
    <DropdownMenu onOpenChange={() => setSearch("")}>
      <DropdownMenuTrigger
        className="[-webkit-app-region:no-drag] inline-flex h-7 max-w-50 items-center gap-1 rounded-md px-2.5 text-sm text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2"
        aria-label={triggerLabel ?? `Device or browser: ${label}`}
        title={
          current
            ? `New runs use ${current.name}`
            : available.length
              ? "Choose a device or browser for new runs"
              : summary.detail
        }
      >
        <MonitorSmartphone className="size-3.5 shrink-0" aria-hidden="true" />
        <span className="min-w-0 truncate">{triggerLabel ?? label}</span>
        <ChevronDown className="size-3 shrink-0 opacity-60" aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        sideOffset={8}
        className="w-80 max-h-[min(480px,var(--available-height))] max-w-[calc(100vw-24px)] overflow-y-auto p-1.5"
      >
        {knownDevices.length > 7 || localBrowsers.length ? (
          <div className="px-1 pb-1">
            <Input
              aria-label="Find a device or browser"
              placeholder="Find a device or browser…"
              value={search}
              onChange={(event) => setSearch(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key !== "Escape" && event.key !== "Tab") event.stopPropagation();
              }}
              className="h-9 text-sm"
            />
          </div>
        ) : null}
        <div className="max-h-[min(320px,50dvh)] overflow-y-auto overscroll-contain">
          {!query && selectedLocalBrowser ? (
            <DropdownMenuGroup>
              <DropdownMenuLabel className="px-2 pb-1 pt-2 text-xs font-medium">
                Selected
              </DropdownMenuLabel>
              {destinationItem(selectedLocalBrowser)}
            </DropdownMenuGroup>
          ) : null}
          {groups.map((group) => {
            if (group === "Local browsers" && !query) return null;
            const members = available.filter(
              (device) => groupFor(device) === group && matches(device),
            );
            if (!members.length) return null;
            return (
              <DropdownMenuGroup key={group}>
                <DropdownMenuLabel className="px-2 pb-1 pt-2 text-xs font-medium">
                  {group}
                </DropdownMenuLabel>
                {members.map(destinationItem)}
              </DropdownMenuGroup>
            );
          })}
          {!query && otherLocalBrowsers.length ? (
            <DropdownMenuSub>
              <DropdownMenuSubTrigger className={rowClass}>
                <Globe className="size-3.5 text-muted-foreground" aria-hidden="true" />
                <span className="flex-1">Local browsers</span>
                <span className="text-xs text-muted-foreground">{otherLocalBrowsers.length}</span>
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="w-80 max-h-[min(360px,60dvh)] overflow-y-auto">
                <DropdownMenuGroup>
                  <DropdownMenuLabel>Local browsers</DropdownMenuLabel>
                  {otherLocalBrowsers.map(destinationItem)}
                </DropdownMenuGroup>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          ) : null}
          {query && !available.some(matches) && !unavailable.some(matches) ? (
            <p role="status" className="px-2 py-3 text-sm text-muted-foreground">
              No matching devices or browsers
            </p>
          ) : null}
          {devices.isError || !available.length ? (
            <p role="status" className="px-2 py-3 text-xs text-muted-foreground">
              {devices.isError
                ? available.length
                  ? "Couldn’t check connected devices. Browser configurations are still available."
                  : "Couldn’t check connected devices."
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
              const members = unavailable.filter(
                (device) => groupFor(device) === group && matches(device),
              );
              if (!members.length) return null;
              return (
                <DropdownMenuSub key={group}>
                  <DropdownMenuSubTrigger className={rowClass}>
                    <span className="flex-1">{group}</span>
                    <span className="text-xs text-muted-foreground">{members.length}</span>
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
                          <span className="text-xs text-muted-foreground">
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
          disabled={devices.isFetching || spaces.isFetching}
          onClick={() => void Promise.allSettled([devices.refetch(), spaces.refetch()])}
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

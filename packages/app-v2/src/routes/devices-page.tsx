/** @jsxImportSource react */
import { Badge } from "@relay/ui-react/components/badge";
import { Button } from "@relay/ui-react/components/button";
import { Item } from "@relay/ui-react/components/item";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@relay/ui-react/components/collapsible";
import { Tabs, TabsList, TabsTrigger } from "@relay/ui-react/components/tabs";
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation, useNavigate, useRouteContext } from "@tanstack/react-router";
import { ChevronRight, CircleHelp, ListChecks } from "lucide-react";
import { useDeferredValue, useEffect, useId, useState } from "react";
import { LibrarySearch } from "../components/library-toolbar";
import { LibraryPage, PageHeader } from "../components/page-layout";
import { EmptyState, RecoveryState } from "../components/product-patterns";
import { deviceSummaryLine } from "../data/device-label";
import {
  deviceQueryKeys,
  type ProductDevice,
  type ProductDeviceStatus,
} from "../data/device-product-service";
import { readSetupContinuation } from "../data/setup-continuation";
import { useCollectionReturnFocus } from "../hooks/use-collection-return-focus";
import { PageLoading } from "./recording-shared";

type DeviceFilter = "all" | Exclude<ProductDeviceStatus, "virtual">;

const FILTERS: readonly { id: DeviceFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "ready", label: "Ready" },
  { id: "needs-attention", label: "Needs attention" },
];

function searchState(value: unknown): {
  status?: string;
  returnTo?: string;
  q?: string;
} {
  return value && typeof value === "object"
    ? (value as { status?: string; returnTo?: string; q?: string })
    : {};
}

function deviceFilter(value: string | undefined): DeviceFilter {
  return value === "ready" || value === "needs-attention" ? value : "all";
}

function isBrowser(device: ProductDevice): boolean {
  return device.platform === "browser";
}

function statusLabel(device: ProductDevice): string {
  if (device.device.booted === false) return "Stopped";
  if (device.status === "needs-attention") return "Needs attention";
  return "Ready";
}

function deviceGroup(device: ProductDevice): string {
  if (isBrowser(device)) return "Browsers";
  if (/simulator/i.test(device.kind ?? "")) return "iOS simulators";
  if (/emulator/i.test(device.kind ?? "")) return "Android emulators";
  return "Physical devices";
}

function DeviceRow({ device, returnTo }: { device: ProductDevice; returnTo?: string }) {
  return (
    <li>
      <Item
        className="relay-library-row relay-device-row grid min-h-16 min-w-0 grid-cols-[minmax(0,1fr)_auto_18px] items-center gap-3 px-3.5 py-2 text-[var(--text-base)] transition-colors duration-150 hover:bg-accent/50 focus-visible:outline-2 focus-visible:outline-[var(--relay-focus-ring)] focus-visible:outline-offset-2"
        render={
          isBrowser(device) ? (
            <Link
              to="/environments/$profileId"
              params={{ profileId: device.id }}
              search={returnTo ? { returnTo } : undefined}
            />
          ) : (
            <Link
              to="/devices/$deviceId"
              params={{ deviceId: device.id }}
              search={returnTo ? { returnTo } : undefined}
            />
          )
        }
      >
        <span className="relay-library-row-main grid min-w-0 gap-1">
          <strong className="overflow-hidden text-ellipsis whitespace-nowrap text-sm font-semibold text-[var(--text-strong)]">
            {device.name}
          </strong>
          <span className="overflow-hidden text-ellipsis whitespace-nowrap text-xs text-[var(--text-weak)]">
            {deviceSummaryLine(device)}
          </span>
        </span>
        <span className="relay-library-row-status flex justify-start">
          <Badge
            className={
              device.status === "needs-attention"
                ? "bg-amber-500/15 text-amber-800 dark:text-amber-300"
                : undefined
            }
            variant="secondary"
          >
            {device.status === "needs-attention" ? (
              <CircleHelp aria-hidden="true" />
            ) : (
              <ListChecks aria-hidden="true" />
            )}
            {statusLabel(device)}
          </Badge>
        </span>
        <ChevronRight
          className="relay-library-row-arrow relay-device-row-chevron text-sm text-[var(--text-weaker)]"
          aria-hidden="true"
        />
      </Item>
    </li>
  );
}

function DeviceSection({
  title,
  devices,
  returnTo,
  bordered = true,
}: {
  title: string;
  devices: readonly ProductDevice[];
  returnTo?: string;
  bordered?: boolean;
}) {
  const headingId = useId();
  return (
    <section
      className="relay-library-results"
      aria-labelledby={title ? headingId : undefined}
      aria-label={!title ? "Available devices" : undefined}
    >
      {title ? (
        <div className="relay-library-results-heading flex min-h-8 items-center gap-2 px-0.5 pb-2.5">
          <h2 id={headingId} className="text-[13px] font-semibold">
            {title}
          </h2>
          <Badge
            variant="secondary"
            className="h-5 min-w-5 justify-center px-1.5 text-[11px] tabular-nums"
          >
            {devices.length}
          </Badge>
        </div>
      ) : null}
      <ul
        className={`relay-library-list m-0 list-none overflow-hidden p-0 [&>li]:border-b [&>li]:border-border [&>li:last-child]:border-b-0 ${bordered ? "rounded-lg border border-border bg-card" : ""}`}
      >
        {devices.map((device) => (
          <DeviceRow key={device.id} device={device} returnTo={returnTo} />
        ))}
      </ul>
    </section>
  );
}

function AvailableSection({
  title,
  devices,
  returnTo,
  searchActive,
}: {
  title: string;
  devices: readonly ProductDevice[];
  returnTo?: string;
  searchActive: boolean;
}) {
  const [open, setOpen] = useState(searchActive);
  useEffect(() => {
    if (searchActive) setOpen(true);
  }, [searchActive]);
  const headingId = useId();
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="grid gap-2">
      <CollapsibleTrigger className="flex min-h-9 items-center gap-2 px-0.5 text-left text-[13px] font-semibold focus-visible:outline-2 focus-visible:outline-ring">
        <ChevronRight
          className={`size-4 text-muted-foreground transition-transform duration-200 motion-reduce:transition-none ${open ? "rotate-90" : ""}`}
          aria-hidden="true"
        />
        <span id={headingId}>{title}</span>
        <Badge
          variant="secondary"
          className="h-5 min-w-5 justify-center px-1.5 text-[11px] tabular-nums"
        >
          {devices.length}
        </Badge>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <DeviceSection title="" devices={devices} returnTo={returnTo} bordered={false} />
      </CollapsibleContent>
    </Collapsible>
  );
}

export function DevicesPage() {
  const { deviceService } = useRouteContext({ from: "__root__" });
  const navigate = useNavigate();
  const rawSearch = useLocation({ select: (state) => state.search });
  const search = searchState(rawSearch);
  const continuation = readSetupContinuation(search.returnTo);
  const activeFilter = deviceFilter(search.status);
  const [query, setQuery] = useState(search.q ?? "");
  const deferredQuery = useDeferredValue(query.trim().toLocaleLowerCase());
  const devices = useQuery({
    queryKey: deviceQueryKeys.devices,
    queryFn: () => deviceService.list(),
    staleTime: 5_000,
  });

  const visibleDevices =
    devices.data?.filter(
      (device) =>
        (activeFilter === "all" ||
          (activeFilter === "ready" ? device.runnable : device.status === activeFilter)) &&
        (!deferredQuery ||
          `${device.name} ${device.platform} ${device.osVersion ?? ""} ${device.kind ?? ""}`
            .toLocaleLowerCase()
            .includes(deferredQuery)),
    ) ?? [];
  const visibleCount = visibleDevices.length;
  const returnFocus = useCollectionReturnFocus("relay:focus:/devices", visibleDevices, "/devices/");

  useEffect(() => {
    if (search.q !== undefined && search.q !== query) setQuery(search.q);
  }, [query, search.q]);

  useEffect(() => {
    if ((search.q ?? "") === query) return;
    void navigate({
      to: "/devices",
      search: {
        ...(activeFilter === "all" ? {} : { status: activeFilter }),
        ...(query.trim() ? { q: query.trim() } : {}),
        ...(search.returnTo ? { returnTo: search.returnTo } : {}),
      },
    });
  }, [activeFilter, navigate, query, search.q, search.returnTo]);

  function updateSearch(next: { status?: DeviceFilter }) {
    const status = next.status ?? activeFilter;
    void navigate({
      to: "/devices",
      search: {
        ...(status === "all" ? {} : { status }),
        ...(query.trim() ? { q: query.trim() } : {}),
        ...(search.returnTo ? { returnTo: search.returnTo } : {}),
      },
    });
  }

  return (
    <LibraryPage
      className="relay-library-page relay-devices-page mx-auto flex min-h-full w-full max-w-[1040px] flex-col"
      onClickCapture={returnFocus.onClickCapture}
    >
      <PageHeader
        title="Devices"
        description="Connected phones, tablets, emulators, and browsers ready for a Test."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button
              nativeButton={false}
              render={
                <Link
                  to="/environments"
                  search={continuation ? { returnTo: search.returnTo } : undefined}
                />
              }
            >
              New browser
            </Button>
            {!devices.isError ? (
              <Button
                variant="ghost"
                onClick={() => void devices.refetch()}
                disabled={devices.isFetching}
              >
                {devices.isFetching ? "Checking…" : "Check again"}
              </Button>
            ) : null}
          </div>
        }
      />

      <div
        className="flex flex-wrap items-center gap-3 border-b border-border pb-4"
        aria-label="Filter devices"
      >
        <LibrarySearch
          id="device-search"
          label="Search Devices and Browsers"
          value={query}
          placeholder="Search by name or platform"
          onChange={setQuery}
        />
        <Tabs
          value={activeFilter}
          onValueChange={(value) => updateSearch({ status: value as DeviceFilter })}
        >
          <TabsList className="h-10" variant="default" aria-label="Filter devices">
            {FILTERS.map((filter) => (
              <TabsTrigger key={filter.id} value={filter.id}>
                {filter.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>

      {devices.isPending ? <PageLoading label="Checking Devices and Browsers…" /> : null}

      {devices.isError ? (
        <RecoveryState
          className="relay-devices-recovery"
          layout="centered"
          title="Relay could not check devices"
          detail="The local Relay service is not responding. Your saved Tests and device settings are safe."
          action={
            <Button variant="default" onClick={() => void devices.refetch()}>
              Check connection
            </Button>
          }
        />
      ) : null}

      {!devices.isPending && !devices.isError && devices.data?.length === 0 ? (
        <div className="flex flex-1 items-center justify-center">
          <EmptyState
            title="No Devices yet"
            detail="Connect a phone or tablet, or start a Browser."
            action={
              <Button
                nativeButton={false}
                render={
                  <Link
                    to="/environments"
                    search={continuation ? { returnTo: search.returnTo } : undefined}
                  />
                }
              >
                New browser
              </Button>
            }
          />
        </div>
      ) : null}

      {!devices.isPending && !devices.isError && devices.data?.length && visibleCount === 0 ? (
        <EmptyState
          title="No devices match your filters"
          detail="Choose another filter to see the devices Relay found."
          action={
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setQuery("");
                void navigate({
                  to: "/devices",
                  search: search.returnTo ? { returnTo: search.returnTo } : {},
                });
              }}
            >
              Show all devices
            </Button>
          }
        />
      ) : null}

      {!devices.isPending && !devices.isError && visibleCount > 0 ? (
        <div className="mt-3 grid gap-7" aria-live="polite">
          {(["Physical devices", "Android emulators", "iOS simulators", "Browsers"] as const).map(
            (title) => {
              const devicesInSection = visibleDevices.filter(
                (device) =>
                  deviceGroup(device) === title &&
                  !device.id.startsWith("avd:") &&
                  !(title === "iOS simulators" && device.device.booted === false),
              );
              if (!devicesInSection.length) return null;
              return (
                <DeviceSection
                  key={title}
                  title={title}
                  devices={devicesInSection}
                  returnTo={continuation ? search.returnTo : undefined}
                />
              );
            },
          )}
          {(() => {
            const available = visibleDevices.filter(
              (device) =>
                device.id.startsWith("avd:") ||
                (deviceGroup(device) === "iOS simulators" && device.device.booted === false),
            );
            if (!available.length) return null;
            const android = available.filter((device) => device.id.startsWith("avd:"));
            const simulators = available.filter((device) => !device.id.startsWith("avd:"));
            return (
              <div className="grid gap-4">
                {simulators.length ? (
                  <AvailableSection
                    title="Available iOS simulators"
                    devices={simulators}
                    returnTo={continuation ? search.returnTo : undefined}
                    searchActive={Boolean(deferredQuery)}
                  />
                ) : null}
                {android.length ? (
                  <AvailableSection
                    title="Available Android emulators"
                    devices={android}
                    returnTo={continuation ? search.returnTo : undefined}
                    searchActive={Boolean(deferredQuery)}
                  />
                ) : null}
              </div>
            );
          })()}
        </div>
      ) : null}
    </LibraryPage>
  );
}

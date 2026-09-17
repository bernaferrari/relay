import { libraryRowSurface, libraryRowContent } from "../components/library-row-styles";
/** @jsxImportSource react */
import { Badge } from "@relay/ui-react/components/badge";
import { Button } from "@relay/ui-react/components/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@relay/ui-react/components/collapsible";
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation, useNavigate, useRouteContext } from "@tanstack/react-router";
import { AppWindow, ChevronRight, CircleHelp, Smartphone, Tablet } from "lucide-react";
import { useDeferredValue, useEffect, useId, useState } from "react";
import { LibrarySearch } from "../components/library-toolbar";
import { LibraryPage, PageHeader } from "../components/page-layout";
import { EmptyState, RecoveryState } from "../components/product-patterns";
import { deviceSummaryLine } from "../data/device-label";
import { deviceQueryKeys, type ProductDevice } from "../data/device-product-service";
import { readSetupContinuation } from "../data/setup-continuation";
import { useCollectionReturnFocus } from "../hooks/use-collection-return-focus";
import { PageLoading } from "./recording-shared";

function searchState(value: unknown): {
  status?: string;
  returnTo?: string;
  q?: string;
} {
  return value && typeof value === "object"
    ? (value as { status?: string; returnTo?: string; q?: string })
    : {};
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
  const DeviceIcon = isBrowser(device)
    ? AppWindow
    : /ipad|tablet/i.test(`${device.name} ${device.kind ?? ""}`)
      ? Tablet
      : Smartphone;
  const stopped = device.device.booted === false;
  return (
    <li>
      <Link
        to={isBrowser(device) ? "/environments/$profileId" : "/devices/$deviceId"}
        params={isBrowser(device) ? { profileId: device.id } : { deviceId: device.id }}
        search={returnTo ? { returnTo } : undefined}
        className={`relay-device-row ${libraryRowSurface} ${libraryRowContent} grid-cols-[minmax(0,1fr)_auto]`}
      >
        <span className="flex min-w-0 items-center gap-3">
          <span
            className="flex size-8 shrink-0 items-center justify-center text-muted-foreground"
            aria-hidden="true"
          >
            <DeviceIcon className="size-5" strokeWidth={1.75} />
          </span>
          <span className="grid min-w-0 gap-0.5">
            <strong className="overflow-hidden text-ellipsis whitespace-nowrap text-sm font-medium text-foreground">
              {device.name}
            </strong>
            <span className="overflow-hidden text-ellipsis whitespace-nowrap text-xs text-muted-foreground">
              {deviceSummaryLine(device)}
            </span>
          </span>
        </span>
        <span className="relay-library-row-status flex min-w-20 items-center gap-2 text-xs text-muted-foreground">
          {!stopped && device.status === "needs-attention" ? (
            <CircleHelp
              className="size-3.5 text-amber-600 dark:text-amber-400"
              aria-hidden="true"
            />
          ) : (
            <span
              aria-hidden="true"
              className={
                stopped
                  ? "size-1.5 shrink-0 rounded-full border border-muted-foreground/60"
                  : "size-1.5 shrink-0 rounded-full bg-emerald-600 dark:bg-emerald-400"
              }
            />
          )}
          {statusLabel(device)}
        </span>
      </Link>
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
      className={bordered ? " overflow-hidden rounded-xl border border-border bg-card" : ""}
      aria-labelledby={title ? headingId : undefined}
      aria-label={!title ? "Available devices" : undefined}
    >
      {title ? (
        <div className="flex min-h-11 items-center gap-2 border-b border-border px-4 py-3">
          <h2 id={headingId} className="text-sm font-semibold">
            {title}
          </h2>
          <Badge
            variant="secondary"
            className="h-auto bg-transparent px-0 text-xs font-normal tabular-nums text-muted-foreground"
          >
            {devices.length}
          </Badge>
        </div>
      ) : null}
      <ul className="m-0 list-none p-0 [&>li]:border-b [&>li]:border-border/60 [&>li:last-child]:border-b-0">
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
    <div className={`${libraryRowSurface} overflow-hidden rounded-xl border border-border bg-card`}>
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger className="flex min-h-11 w-full items-center gap-2 px-4 py-3 text-left text-sm font-semibold outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
          <ChevronRight
            className={`size-4 text-muted-foreground transition-transform duration-200 motion-reduce:transition-none ${open ? "rotate-90" : ""}`}
            aria-hidden="true"
          />
          <span id={headingId}>{title}</span>
          <Badge
            variant="secondary"
            className="h-auto bg-transparent px-0 text-xs font-normal tabular-nums text-muted-foreground"
          >
            {devices.length}
          </Badge>
        </CollapsibleTrigger>
        <CollapsibleContent className="border-t border-border">
          <DeviceSection title="" devices={devices} returnTo={returnTo} bordered={false} />
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}

export function DevicesPage() {
  const { deviceService } = useRouteContext({ from: "__root__" });
  const navigate = useNavigate();
  const rawSearch = useLocation({ select: (state) => state.search });
  const search = searchState(rawSearch);
  const continuation = readSetupContinuation(search.returnTo);
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
        !deferredQuery ||
        `${device.name} ${device.platform} ${device.osVersion ?? ""} ${device.kind ?? ""}`
          .toLocaleLowerCase()
          .includes(deferredQuery),
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
        ...(query.trim() ? { q: query.trim() } : {}),
        ...(search.returnTo ? { returnTo: search.returnTo } : {}),
      },
    });
  }, [navigate, query, search.q, search.returnTo]);

  return (
    <LibraryPage
      className="mx-auto flex min-h-full w-full max-w-5xl flex-col"
      onClickCapture={returnFocus.onClickCapture}
    >
      <PageHeader
        title="Devices"
        description="Choose a device or browser to inspect or record a test."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button
              nativeButton={false}
              render={
                <Link
                  to="/environments"
                  search={{ view: "new", ...(continuation ? { returnTo: search.returnTo } : {}) }}
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
        aria-label="Search devices"
      >
        <LibrarySearch
          id="device-search"
          label="Search Devices and Browsers"
          value={query}
          placeholder="Search by name or platform"
          onChange={setQuery}
        />
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
                    search={{ view: "new", ...(continuation ? { returnTo: search.returnTo } : {}) }}
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
          title="No devices match your search"
          detail="Try another device name or platform."
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
        <div className="mt-3 grid gap-4" aria-live="polite">
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

/** @jsxImportSource react */
import { Badge } from "@relay/ui-react/components/badge";
import { Button } from "@relay/ui-react/components/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@relay/ui-react/components/collapsible";
import { Input } from "@relay/ui-react/components/input";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
} from "@relay/ui-react/components/item";
import { Tabs, TabsList, TabsTrigger } from "@relay/ui-react/components/tabs";
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation, useNavigate, useRouteContext } from "@tanstack/react-router";
import { ChevronDown, ChevronRight, Monitor, Smartphone, Tablet } from "lucide-react";
import { useDeferredValue, useEffect, useState } from "react";
import { LibraryPage, PageHeader } from "../components/page-layout";
import { EmptyState, RecoveryState } from "../components/product-patterns";
import {
  deviceQueryKeys,
  type ProductDevice,
  type ProductDeviceStatus,
} from "../data/device-product-service";
import { PageLoading } from "./recording-shared";
import { readSetupContinuation } from "../data/setup-continuation";
import { useCollectionReturnFocus } from "../hooks/use-collection-return-focus";

type DeviceFilter = "all" | Exclude<ProductDeviceStatus, "virtual">;
type DeviceTypeFilter = "all" | "physical" | "virtual";

const FILTERS: readonly { id: DeviceFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "ready", label: "Ready" },
  { id: "needs-attention", label: "Needs attention" },
];
const TYPE_FILTERS: readonly { id: DeviceTypeFilter; label: string }[] = [
  { id: "all", label: "All types" },
  { id: "physical", label: "Physical" },
  { id: "virtual", label: "Virtual" },
];

const SECTIONS: readonly {
  id: ProductDeviceStatus;
  title: string;
  description: string;
}[] = [
  {
    id: "ready",
    title: "Ready",
    description: "Connected devices Relay can use now.",
  },
  {
    id: "needs-attention",
    title: "Needs attention",
    description: "Devices waiting for one clear recovery step.",
  },
  {
    id: "virtual",
    title: "Virtual devices",
    description: "Managed browsers, simulators, and emulators.",
  },
];

function searchState(value: unknown): {
  status?: string;
  type?: string;
  returnTo?: string;
  q?: string;
} {
  return value && typeof value === "object"
    ? (value as { status?: string; type?: string; returnTo?: string })
    : {};
}

function deviceFilter(value: string | undefined): DeviceFilter {
  return value === "ready" || value === "needs-attention" ? value : "all";
}

function deviceTypeFilter(value: string | undefined): DeviceTypeFilter {
  return value === "physical" || value === "virtual" ? value : "all";
}

function platformLabel(device: ProductDevice): string {
  if (device.platform === "ios") return "Apple device";
  if (device.platform === "android") return "Android device";
  return "Managed browser";
}

function statusLabel(device: ProductDevice): string {
  if (device.status === "needs-attention") return "Needs attention";
  if (device.status === "virtual") return "Available";
  return "Ready";
}

function deviceMetadata(device: ProductDevice): string {
  return [...new Set([platformLabel(device), device.osVersion, device.kind].filter(Boolean))].join(
    " · ",
  );
}

function DeviceIcon({ device }: { device: ProductDevice }) {
  const className = "grid size-9 place-items-center rounded-md border border-border bg-background";
  if (device.platform === "browser")
    return (
      <span className={className}>
        <Monitor className="size-5" aria-hidden="true" />
      </span>
    );
  if (/ipad|tablet/iu.test(`${device.name} ${device.kind ?? ""}`)) {
    return (
      <span className={className}>
        <Tablet className="size-5" aria-hidden="true" />
      </span>
    );
  }
  return (
    <span className={className}>
      <Smartphone className="size-5" aria-hidden="true" />
    </span>
  );
}

function DeviceRow({ device, returnTo }: { device: ProductDevice; returnTo?: string }) {
  return (
    <li className="border-b border-border last:border-b-0">
      <Item
        className="relay-device-row flex min-h-20 w-full items-center gap-4 rounded-none px-4 py-3 transition-colors hover:bg-muted/50"
        size="sm"
        render={
          <Link
            to="/devices/$deviceId"
            params={{ deviceId: device.id }}
            search={returnTo ? { returnTo } : undefined}
          />
        }
      >
        <ItemMedia>
          <DeviceIcon device={device} />
        </ItemMedia>
        <ItemContent>
          <ItemTitle>{device.name}</ItemTitle>
          <ItemDescription>{deviceMetadata(device)}</ItemDescription>
        </ItemContent>
        <ItemActions className="flex shrink-0 items-center gap-3">
          <Badge
            variant={device.status === "needs-attention" ? "destructive" : "default"}
            className={
              device.status === "needs-attention"
                ? "bg-amber-500/15 text-amber-800 dark:text-amber-300"
                : "bg-emerald-500/15 text-emerald-800 dark:text-emerald-300"
            }
          >
            {statusLabel(device)}
          </Badge>
          <ChevronRight
            className="relay-device-row-chevron size-4 text-muted-foreground"
            aria-hidden="true"
          />
        </ItemActions>
      </Item>
    </li>
  );
}

function DeviceSection({
  title,
  description,
  devices,
  returnTo,
  collapsed = false,
}: {
  title: string;
  description: string;
  devices: readonly ProductDevice[];
  returnTo?: string;
  collapsed?: boolean;
}) {
  const headingId = `device-section-${title.toLowerCase().replaceAll(" ", "-")}`;
  const content = (
    <ul className="list-none overflow-hidden rounded-lg border border-border bg-card p-0">
      {devices.map((device) => (
        <DeviceRow key={device.id} device={device} returnTo={returnTo} />
      ))}
    </ul>
  );
  if (collapsed) {
    return (
      <Collapsible className="overflow-hidden rounded-xl border bg-card">
        <CollapsibleTrigger className="group flex min-h-14 w-full items-center justify-between gap-4 px-4 py-3 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
          <span className="grid min-w-0 gap-0.5">
            <strong id={headingId} className="text-sm font-medium text-foreground">
              {title}
            </strong>
            <small className="truncate text-xs font-normal text-muted-foreground">
              {description}
            </small>
          </span>
          <span className="flex shrink-0 items-center gap-2">
            <Badge variant="secondary" className="tabular-nums">
              {devices.length} available
            </Badge>
            <ChevronDown
              className="size-4 text-muted-foreground transition-transform group-data-[panel-open]:rotate-180"
              aria-hidden="true"
            />
          </span>
        </CollapsibleTrigger>
        <CollapsibleContent className="border-t p-3">{content}</CollapsibleContent>
      </Collapsible>
    );
  }
  return (
    <section className="grid gap-3" aria-labelledby={headingId}>
      <header>
        <div>
          <div className="flex items-center gap-2">
            <h2 id={headingId} className="text-sm font-semibold">
              {title}
            </h2>
            <span
              className="text-xs text-muted-foreground"
              aria-label={`${devices.length} devices`}
            >
              {devices.length}
            </span>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        </div>
      </header>
      {content}
    </section>
  );
}

export function DevicesPage() {
  const { deviceService } = useRouteContext({ from: "__root__" });
  const navigate = useNavigate();
  const rawSearch = useLocation({ select: (state) => state.search });
  const search = searchState(rawSearch);
  const continuation = readSetupContinuation(search.returnTo);
  const activeFilter = deviceFilter(search.status);
  const activeTypeFilter = search.status === "virtual" ? "virtual" : deviceTypeFilter(search.type);
  const [query, setQuery] = useState(search.q ?? "");
  const deferredQuery = useDeferredValue(query.trim().toLocaleLowerCase());
  const devices = useQuery({
    queryKey: deviceQueryKeys.devices,
    queryFn: () => deviceService.list(),
    staleTime: 5_000,
  });

  const shownSections = SECTIONS.filter(
    (section) => activeFilter === "all" || section.id === activeFilter,
  );
  const visibleDevices =
    devices.data?.filter(
      (device) =>
        (activeFilter === "all" ||
          (activeFilter === "ready" ? device.runnable : device.status === activeFilter)) &&
        (activeTypeFilter === "all" ||
          (activeTypeFilter === "virtual"
            ? device.status === "virtual"
            : device.status !== "virtual")) &&
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
        ...(activeTypeFilter === "all" ? {} : { type: activeTypeFilter }),
        ...(query.trim() ? { q: query.trim() } : {}),
        ...(search.returnTo ? { returnTo: search.returnTo } : {}),
      },
    });
  }, [activeFilter, activeTypeFilter, navigate, query, search.q, search.returnTo]);

  function updateSearch(next: { status?: DeviceFilter; type?: DeviceTypeFilter }) {
    const status = next.status ?? activeFilter;
    const type = next.type ?? activeTypeFilter;
    void navigate({
      to: "/devices",
      search: {
        ...(status === "all" ? {} : { status }),
        ...(type === "all" ? {} : { type }),
        ...(query.trim() ? { q: query.trim() } : {}),
        ...(search.returnTo ? { returnTo: search.returnTo } : {}),
      },
    });
  }

  return (
    <LibraryPage onClickCapture={returnFocus.onClickCapture}>
      <PageHeader
        context="Workspace"
        title="Devices"
        description="Choose a device or browser, then inspect or record."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              nativeButton={false}
              render={
                <Link
                  to="/environments"
                  search={continuation ? { returnTo: search.returnTo } : undefined}
                />
              }
            >
              Manage browsers
            </Button>
            {!devices.isError ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void devices.refetch()}
                disabled={devices.isFetching}
              >
                {devices.isFetching ? "Checking…" : "Check again"}
              </Button>
            ) : null}
          </div>
        }
      />

      <div className="mb-6 grid min-w-0 grid-cols-1 gap-4 border-b border-border pb-4 min-[780px]:grid-cols-[minmax(0,1fr)_auto]">
        <Tabs
          className="order-3 min-w-0 min-[780px]:col-span-full"
          value={activeFilter}
          onValueChange={(value) => updateSearch({ status: value as DeviceFilter })}
        >
          <TabsList className="max-w-full justify-start" variant="line" aria-label="Filter devices">
            {FILTERS.map((filter) => (
              <TabsTrigger key={filter.id} value={filter.id}>
                {filter.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <Tabs
          className="order-2 min-w-0"
          value={activeTypeFilter}
          onValueChange={(value) => updateSearch({ type: value as DeviceTypeFilter })}
        >
          <TabsList className="max-w-full justify-start" aria-label="Filter device type">
            {TYPE_FILTERS.map((filter) => (
              <TabsTrigger key={filter.id} value={filter.id}>
                {filter.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <Input
          className="order-1 w-full min-w-0 max-w-lg"
          type="search"
          value={query}
          onChange={(event) => setQuery(event.currentTarget.value)}
          placeholder="Search devices"
          aria-label="Search devices"
        />
      </div>

      {devices.isPending ? <PageLoading label="Checking connected and virtual devices…" /> : null}

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
        <EmptyState
          title="No devices found yet"
          detail="Connect an iPhone, iPad, or Android device, or configure a managed browser. Relay will keep checking when you return."
          action={
            <Button variant="default" onClick={() => void devices.refetch()}>
              Check for devices
            </Button>
          }
        />
      ) : null}

      {!devices.isPending && !devices.isError && devices.data?.length && visibleCount === 0 ? (
        <EmptyState
          title="No devices match your filters"
          detail="Choose another filter to see the devices Relay found."
          action={
            <Button
              variant="outline"
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
        <div className="grid gap-7" aria-live="polite">
          {shownSections
            .filter((section) =>
              visibleDevices.some((device) =>
                activeFilter === "ready" && section.id === "ready"
                  ? device.runnable
                  : device.status === section.id,
              ),
            )
            .map((section) => (
              <DeviceSection
                key={section.id}
                title={section.title}
                description={section.description}
                devices={visibleDevices.filter((device) =>
                  activeFilter === "ready" && section.id === "ready"
                    ? device.runnable
                    : device.status === section.id,
                )}
                returnTo={continuation ? search.returnTo : undefined}
                collapsed={activeFilter === "all" && section.id === "virtual"}
              />
            ))}
        </div>
      ) : null}
    </LibraryPage>
  );
}

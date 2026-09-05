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
import { useDeferredValue, useState } from "react";
import { EmptyState, RecoveryState } from "../components/product-patterns";
import {
  deviceQueryKeys,
  type ProductDevice,
  type ProductDeviceStatus,
} from "../data/device-product-service";
import { PageLoading } from "./recording-shared";
import { readSetupContinuation } from "../data/setup-continuation";

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

function searchState(value: unknown): { status?: string; type?: string; returnTo?: string } {
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
  const className = "relay-device-icon";
  if (device.platform === "browser") return <Monitor className={className} aria-hidden="true" />;
  if (/ipad|tablet/iu.test(`${device.name} ${device.kind ?? ""}`)) {
    return <Tablet className={className} aria-hidden="true" />;
  }
  return <Smartphone className={className} aria-hidden="true" />;
}

function DeviceRow({ device, returnTo }: { device: ProductDevice; returnTo?: string }) {
  return (
    <li className="relay-device-row-item">
      <Item
        className="relay-device-row"
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
        <ItemActions className="relay-device-row-end">
          <Badge
            variant={device.status === "needs-attention" ? "destructive" : "default"}
            className={
              device.status === "needs-attention"
                ? "bg-amber-500/15 text-amber-700 dark:text-amber-300"
                : "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
            }
          >
            {statusLabel(device)}
          </Badge>
          <ChevronRight className="relay-device-row-chevron" aria-hidden="true" />
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
    <ul className="relay-device-list">
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
    <section className="relay-device-section" aria-labelledby={headingId}>
      <header>
        <div>
          <div className="relay-device-section-title">
            <h2 id={headingId}>{title}</h2>
            <span className="relay-device-count" aria-label={`${devices.length} devices`}>
              {devices.length}
            </span>
          </div>
          <p>{description}</p>
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
  const [query, setQuery] = useState("");
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

  function updateSearch(next: { status?: DeviceFilter; type?: DeviceTypeFilter }) {
    const status = next.status ?? activeFilter;
    const type = next.type ?? activeTypeFilter;
    void navigate({
      to: "/devices",
      search: {
        ...(status === "all" ? {} : { status }),
        ...(type === "all" ? {} : { type }),
        ...(search.returnTo ? { returnTo: search.returnTo } : {}),
      },
    });
  }

  return (
    <section className="relay-page relay-devices-page">
      <header className="relay-page-header relay-devices-header">
        <div>
          <p className="relay-eyebrow">Workspace</p>
          <h1>Devices</h1>
          <p className="relay-page-description">
            See what is ready, what needs help, and which virtual devices are available for a Test.
          </p>
        </div>
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
            <Button size="sm" onClick={() => void devices.refetch()} disabled={devices.isFetching}>
              {devices.isFetching ? "Checking…" : "Check again"}
            </Button>
          ) : null}
        </div>
      </header>

      <div className="mt-8 flex min-w-0 flex-col gap-3 border-b border-border/60 pb-4 md:flex-row md:items-center">
        <Tabs
          className="min-w-0 flex-1"
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
          className="min-w-0 md:max-w-[270px]"
          value={activeTypeFilter}
          onValueChange={(value) => updateSearch({ type: value as DeviceTypeFilter })}
        >
          <TabsList
            className="max-w-full justify-start"
            variant="line"
            aria-label="Filter device type"
          >
            {TYPE_FILTERS.map((filter) => (
              <TabsTrigger key={filter.id} value={filter.id}>
                {filter.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <Input
          className="w-full min-w-0 md:w-56 md:max-w-[35%]"
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
          title={`No ${FILTERS.find((item) => item.id === activeFilter)?.label.toLowerCase()} devices`}
          detail="Choose another filter to see the devices Relay found."
          action={
            <Button variant="outline" onClick={() => updateSearch({ status: "all" })}>
              Show all devices
            </Button>
          }
        />
      ) : null}

      {!devices.isPending && !devices.isError && visibleCount > 0 ? (
        <div className="relay-device-sections" aria-live="polite">
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
    </section>
  );
}

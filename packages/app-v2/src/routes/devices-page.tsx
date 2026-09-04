/** @jsxImportSource react */
import { Button, Input } from "@relay/ui-react";
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

type DeviceFilter = "all" | ProductDeviceStatus;

const FILTERS: readonly { id: DeviceFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "ready", label: "Ready" },
  { id: "needs-attention", label: "Needs attention" },
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

function searchState(value: unknown): { status?: string } {
  return value && typeof value === "object" ? (value as { status?: string }) : {};
}

function deviceFilter(value: string | undefined): DeviceFilter {
  return value === "ready" || value === "needs-attention" || value === "virtual" ? value : "all";
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

function DeviceRow({ device }: { device: ProductDevice }) {
  return (
    <li className="relay-device-row-item">
      <Link className="relay-device-row" to="/devices/$deviceId" params={{ deviceId: device.id }}>
        <span className="relay-device-icon-tile">
          <DeviceIcon device={device} />
        </span>
        <span className="relay-device-copy">
          <strong>{device.name}</strong>
          <span className="relay-device-metadata">{deviceMetadata(device)}</span>
        </span>
        <span className="relay-device-row-end">
          <span className={`relay-device-status relay-device-status--${device.status}`}>
            <span aria-hidden="true" />
            {statusLabel(device)}
          </span>
          <ChevronRight className="relay-device-row-chevron" aria-hidden="true" />
        </span>
      </Link>
    </li>
  );
}

function DeviceSection({
  title,
  description,
  devices,
  collapsed = false,
}: {
  title: string;
  description: string;
  devices: readonly ProductDevice[];
  collapsed?: boolean;
}) {
  const headingId = `device-section-${title.toLowerCase().replaceAll(" ", "-")}`;
  const content = (
    <ul className="relay-device-list">
      {devices.map((device) => (
        <DeviceRow key={device.id} device={device} />
      ))}
    </ul>
  );
  if (collapsed) {
    return (
      <details className="relay-device-section relay-device-section--collapsible">
        <summary>
          <span>
            <strong id={headingId}>{title}</strong>
            <small>{description}</small>
          </span>
          <span className="relay-device-section-summary-end">
            <span className="relay-device-count">{devices.length} available</span>
            <ChevronDown aria-hidden="true" />
          </span>
        </summary>
        {content}
      </details>
    );
  }
  return (
    <section className="relay-device-section" aria-labelledby={headingId}>
      <header>
        <div>
          <h2 id={headingId}>{title}</h2>
          <p>{description}</p>
        </div>
        <span className="relay-device-count" aria-label={`${devices.length} devices`}>
          {devices.length}
        </span>
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
  const activeFilter = deviceFilter(search.status);
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
        (activeFilter === "all" || device.status === activeFilter) &&
        (!deferredQuery ||
          `${device.name} ${device.platform} ${device.osVersion ?? ""} ${device.kind ?? ""}`
            .toLocaleLowerCase()
            .includes(deferredQuery)),
    ) ?? [];
  const visibleCount = visibleDevices.length;

  function updateSearch(next: { status?: DeviceFilter }) {
    const status = next.status ?? activeFilter;
    void navigate({
      to: "/devices",
      search: status === "all" ? {} : { status },
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
        {!devices.isError ? (
          <Button size="small" onClick={() => void devices.refetch()} disabled={devices.isFetching}>
            {devices.isFetching ? "Checking…" : "Check again"}
          </Button>
        ) : null}
      </header>

      <div className="relay-device-toolbar">
        <div className="relay-segmented-control" role="group" aria-label="Filter devices">
          {FILTERS.map((filter) => (
            <button
              key={filter.id}
              type="button"
              aria-pressed={activeFilter === filter.id}
              onClick={() => updateSearch({ status: filter.id })}
            >
              {filter.label}
            </button>
          ))}
        </div>
        <Input
          className="relay-device-search"
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
            <Button variant="primary" onClick={() => void devices.refetch()}>
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
            <Button variant="primary" onClick={() => void devices.refetch()}>
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
            <Button variant="secondary" onClick={() => updateSearch({ status: "all" })}>
              Show all devices
            </Button>
          }
        />
      ) : null}

      {!devices.isPending && !devices.isError && visibleCount > 0 ? (
        <div className="relay-device-sections" aria-live="polite">
          {shownSections
            .filter((section) => visibleDevices.some((device) => device.status === section.id))
            .map((section) => (
              <DeviceSection
                key={section.id}
                title={section.title}
                description={section.description}
                devices={visibleDevices.filter((device) => device.status === section.id)}
                collapsed={activeFilter === "all" && section.id === "virtual"}
              />
            ))}
        </div>
      ) : null}
    </section>
  );
}

import { libraryRowSurface, libraryRowContent } from "../components/library-row-styles";
/** @jsxImportSource react */
import { isGoalScratchTarget } from "../data/target-presentation";
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
import {
  createContext,
  useContext,
  useDeferredValue,
  useEffect,
  useId,
  useMemo,
  useState,
} from "react";
import { SiteIcon, siteHost } from "../components/site-icon";
import type { ProductBrowserSpace } from "../data/browser-spaces-product-service";
import { LibrarySearch } from "../components/library-toolbar";
import { LibraryPage, PageHeader } from "../components/page-layout";
import { EmptyState } from "../components/product-patterns";
import { deviceSummaryLine } from "../data/device-label";
import { deviceQueryKeys, type ProductDevice } from "../data/device-product-service";
import { readSetupContinuation } from "../data/setup-continuation";
import { useCollectionReturnFocus } from "../hooks/use-collection-return-focus";
import { PageLoading, RecordingProblem, RefreshProblem } from "./recording-shared";

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
  if (isBrowser(device) && isGoalScratchTarget(device.id)) return "Agent scratch browsers";
  if (isBrowser(device)) return "Browsers";
  if (/simulator/i.test(device.kind ?? "")) return "iOS simulators";
  if (/emulator/i.test(device.kind ?? "")) return "Android emulators";
  return "Physical devices";
}

/** A tiny drawing of the hardware so the grid reads at a glance. */
function DeviceSilhouette({ kind }: { kind: "phone" | "tablet" | "window" }) {
  if (kind === "window") {
    return (
      <span className="flex h-7 w-9 flex-col overflow-hidden rounded-md border-2 border-foreground/70 bg-card">
        <span className="h-1.5 border-b border-foreground/40 bg-foreground/10" />
      </span>
    );
  }
  return (
    <span
      className={`relative rounded-md border-2 border-foreground/70 bg-card ${kind === "tablet" ? "h-8 w-6.5" : "h-8 w-4.5"}`}
    >
      <span className="absolute top-0.5 left-1/2 h-0.5 w-1.5 -translate-x-1/2 rounded-full bg-foreground/60" />
    </span>
  );
}

type BrowserSites = ReadonlyMap<string, ProductBrowserSpace>;
const BrowserSitesContext = createContext<BrowserSites>(new Map());

function DeviceRow({
  device,
  returnTo,
  stale = false,
}: {
  device: ProductDevice;
  returnTo?: string;
  stale?: boolean;
}) {
  const DeviceIcon = isBrowser(device)
    ? AppWindow
    : /ipad|tablet/i.test(`${device.name} ${device.kind ?? ""}`)
      ? Tablet
      : Smartphone;
  const stopped = device.device.booted === false;
  const site = useContext(BrowserSitesContext).get(device.id);
  const host = siteHost(site?.startUrl);
  return (
    <li>
      <Link
        to={isBrowser(device) ? "/environments/$profileId" : "/devices/$deviceId"}
        params={isBrowser(device) ? { profileId: device.id } : { deviceId: device.id }}
        search={returnTo ? { returnTo } : undefined}
        data-slot="device-row"
        className="group/device flex h-full min-w-0 items-center gap-3.5 rounded-xl border border-border bg-card p-3.5 transition-[border-color,box-shadow] duration-150 ease-out outline-none hover:border-primary/40 hover:shadow-sm focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none"
      >
        <span
          className="flex size-12 shrink-0 items-center justify-center rounded-lg bg-stage"
          aria-hidden="true"
        >
          {isBrowser(device) && site ? (
            <SiteIcon url={site.startUrl} className="size-7" />
          ) : (
            <DeviceSilhouette
              kind={
                DeviceIcon === AppWindow ? "window" : DeviceIcon === Tablet ? "tablet" : "phone"
              }
            />
          )}
        </span>
        <span className="grid min-w-0 flex-1 gap-0.5">
          <strong className="truncate text-sm font-semibold text-foreground">{device.name}</strong>
          <span className="truncate text-xs text-muted-foreground">
            {isBrowser(device) && host
              ? [host, site?.viewport ? `${site.viewport.width} × ${site.viewport.height}` : ""]
                  .filter(Boolean)
                  .join(" · ")
              : deviceSummaryLine(device)}
          </span>
          <span
            data-slot="library-row-status"
            className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground"
          >
            {stale ? (
              <CircleHelp className="size-3.5" aria-hidden="true" />
            ) : !stopped && device.status === "needs-attention" ? (
              <CircleHelp className="size-3.5 text-warning-foreground" aria-hidden="true" />
            ) : (
              <span
                aria-hidden="true"
                className={
                  stopped
                    ? "size-2 shrink-0 rounded-full border border-muted-foreground/60"
                    : "size-2 shrink-0 rounded-full bg-success"
                }
              />
            )}
            {stale ? "Status unavailable" : statusLabel(device)}
          </span>
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
  stale = false,
}: {
  title: string;
  devices: readonly ProductDevice[];
  returnTo?: string;
  bordered?: boolean;
  stale?: boolean;
}) {
  const headingId = useId();
  return (
    <section
      className=""
      aria-labelledby={title ? headingId : undefined}
      aria-label={!title ? "Available devices" : undefined}
    >
      {title ? (
        <div className="flex min-h-9 items-center gap-2 px-1 pb-2">
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
      <ul className="m-0 grid list-none gap-3 p-0 sm:grid-cols-2 xl:grid-cols-3">
        {devices.map((device) => (
          <DeviceRow key={device.id} device={device} returnTo={returnTo} stale={stale} />
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
  stale = false,
}: {
  title: string;
  devices: readonly ProductDevice[];
  returnTo?: string;
  searchActive: boolean;
  stale?: boolean;
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
          <DeviceSection
            title=""
            devices={devices}
            returnTo={returnTo}
            bordered={false}
            stale={stale}
          />
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}

export function DevicesPage() {
  const { deviceService, browserSpacesService } = useRouteContext({ from: "__root__" });
  const spaces = useQuery({
    queryKey: ["devices", "browser-spaces"],
    queryFn: () => browserSpacesService.listSpaces(),
    staleTime: 30_000,
  });
  const sites = useMemo<BrowserSites>(
    () => new Map((spaces.data ?? []).map((space) => [space.id, space])),
    [spaces.data],
  );
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
    <BrowserSitesContext.Provider value={sites}>
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

        <RecordingProblem
          error={devices.data === undefined ? devices.error : null}
          onRetry={() => void devices.refetch()}
          retrying={devices.isFetching}
          layout="centered"
        />
        {devices.isError && devices.data !== undefined ? (
          <RefreshProblem
            subject="devices"
            onRetry={() => void devices.refetch()}
            retrying={devices.isFetching}
          />
        ) : null}

        {devices.data !== undefined && devices.data?.length === 0 ? (
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
                      search={{
                        view: "new",
                        ...(continuation ? { returnTo: search.returnTo } : {}),
                      }}
                    />
                  }
                >
                  New browser
                </Button>
              }
            />
          </div>
        ) : null}

        {devices.data !== undefined && devices.data?.length && visibleCount === 0 ? (
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

        {devices.data !== undefined && visibleCount > 0 ? (
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
                    stale={devices.isError}
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
              const scratch = visibleDevices.filter(
                (device) => deviceGroup(device) === "Agent scratch browsers",
              );
              if (!available.length && !scratch.length) return null;
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
                      stale={devices.isError}
                    />
                  ) : null}
                  {android.length ? (
                    <AvailableSection
                      title="Available Android emulators"
                      devices={android}
                      returnTo={continuation ? search.returnTo : undefined}
                      searchActive={Boolean(deferredQuery)}
                      stale={devices.isError}
                    />
                  ) : null}
                  {scratch.length ? (
                    <AvailableSection
                      title="Agent scratch browsers"
                      devices={scratch}
                      returnTo={continuation ? search.returnTo : undefined}
                      searchActive={Boolean(deferredQuery)}
                      stale={devices.isError}
                    />
                  ) : null}
                </div>
              );
            })()}
          </div>
        ) : null}
      </LibraryPage>
    </BrowserSitesContext.Provider>
  );
}

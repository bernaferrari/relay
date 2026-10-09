import { libraryRowSurface } from "../components/library-row-styles";
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
import {
  AppWindow,
  ChevronRight,
  CircleHelp,
  Plus,
  RotateCw,
  Smartphone,
  Tablet,
  Usb,
} from "lucide-react";
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
import {
  deviceMatchesCatalogSearch,
  browserCatalogQueryKey,
  groupBrowserDestinations,
  isLoopbackBrowserUrl,
  mergeDeviceCatalog,
  type BrowserDestinationGroup,
} from "../data/device-catalog-presentation";
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

/** Two groups people choose between: hardware-like targets and browsers. Each
 * card already says whether it is physical, an emulator, or a simulator. */
function deviceGroup(device: ProductDevice): string {
  if (isBrowser(device) && isGoalScratchTarget(device.id)) return "Created by agents";
  if (isBrowser(device)) return "Browsers";
  return "Phones and tablets";
}

function isNotRunning(device: ProductDevice): boolean {
  return (
    device.id.startsWith("avd:") ||
    (/simulator/i.test(device.kind ?? "") && device.device.booted === false)
  );
}

/** A tiny drawing of the hardware so the grid reads at a glance. */
function DeviceSilhouette({ kind }: { kind: "phone" | "tablet" | "window" | "android" }) {
  if (kind === "android") {
    return (
      <svg
        data-slot="android-device-icon"
        viewBox="0 0 24 24"
        className="size-8 text-foreground/70"
        aria-hidden="true"
      >
        <path
          d="m7 7-2-3m12 3 2-3"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
        <path d="M2 18a10 10 0 0 1 20 0Z" fill="currentColor" />
        <circle cx="7.5" cy="14" r="1" className="fill-stage" />
        <circle cx="16.5" cy="14" r="1" className="fill-stage" />
      </svg>
    );
  }
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

/** First-run help where a phone would appear: what to do, not an empty grid. */
function ConnectDeviceHint({ canStartEmulator }: { canStartEmulator: boolean }) {
  return (
    <section aria-label="Phones and tablets">
      <div className="flex min-h-9 items-center px-1 pb-2">
        <h2 className="text-sm font-semibold">Phones and tablets</h2>
      </div>
      <div className="flex items-center gap-3.5 rounded-xl border border-dashed border-border p-4">
        <span
          className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground"
          aria-hidden="true"
        >
          <Usb className="size-5" />
        </span>
        <span className="grid gap-0.5 text-sm">
          <strong className="font-medium">Connect a phone or tablet</strong>
          <span className="text-muted-foreground">
            Plug it in by USB and unlock it. Relay finds it automatically.
            {canStartEmulator ? " Or start an emulator from Not running below." : ""}
          </span>
        </span>
      </div>
    </section>
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
                device.platform === "android"
                  ? "android"
                  : DeviceIcon === AppWindow
                    ? "window"
                    : DeviceIcon === Tablet
                      ? "tablet"
                      : "phone"
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
          {/* Ready is the normal state; only say something when it isn't. */}
          {(!isBrowser(device) && (stopped || device.status === "needs-attention")) || stale ? (
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
          ) : null}
        </span>
      </Link>
    </li>
  );
}

function BrowserDestinationRow({
  group,
  returnTo,
  searchActive,
  stale,
}: {
  group: BrowserDestinationGroup;
  returnTo?: string;
  searchActive: boolean;
  stale: boolean;
}) {
  const [open, setOpen] = useState(searchActive);
  useEffect(() => {
    setOpen(searchActive);
  }, [searchActive]);
  return (
    <li className={open ? "sm:col-span-2 xl:col-span-3" : ""}>
      <Collapsible
        open={open}
        onOpenChange={setOpen}
        data-slot="browser-destination-group"
        className="overflow-hidden rounded-xl border border-border bg-card"
      >
        <CollapsibleTrigger className="flex min-h-24 w-full items-center gap-3.5 p-3.5 text-left outline-none transition-colors duration-150 hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring motion-reduce:transition-none">
          <span
            className="flex size-12 shrink-0 items-center justify-center rounded-lg bg-stage"
            aria-hidden="true"
          >
            <SiteIcon url={group.url} className="size-7" />
          </span>
          <span className="grid min-w-0 flex-1 gap-1">
            <strong className="truncate text-sm font-semibold">{group.label}</strong>
            <span className="text-xs text-muted-foreground">{group.devices.length} browsers</span>
          </span>
          <ChevronRight
            className={`size-4 shrink-0 text-muted-foreground transition-transform duration-200 motion-reduce:transition-none ${open ? "rotate-90" : ""}`}
            aria-hidden="true"
          />
        </CollapsibleTrigger>
        <CollapsibleContent className="border-t border-border">
          <ul className="m-0 grid list-none gap-3 p-3.5 sm:grid-cols-2 xl:grid-cols-3">
            {group.devices.map((device) => (
              <DeviceRow key={device.id} device={device} returnTo={returnTo} stale={stale} />
            ))}
          </ul>
        </CollapsibleContent>
      </Collapsible>
    </li>
  );
}

function DeviceSection({
  title,
  devices,
  returnTo,
  bordered = true,
  stale = false,
  groupBrowsers = false,
  searchActive = false,
}: {
  title: string;
  devices: readonly ProductDevice[];
  returnTo?: string;
  bordered?: boolean;
  stale?: boolean;
  groupBrowsers?: boolean;
  searchActive?: boolean;
}) {
  const headingId = useId();
  const sites = useContext(BrowserSitesContext);
  const browserGroups = groupBrowsers
    ? groupBrowserDestinations(devices, sites, { keepNamedSeparate: title === "Browsers" })
    : [];
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
        {groupBrowsers
          ? browserGroups.map((group) =>
              group.devices.length === 1 ? (
                <DeviceRow
                  key={group.key}
                  device={group.devices[0]!}
                  returnTo={returnTo}
                  stale={stale}
                />
              ) : (
                <BrowserDestinationRow
                  key={group.key}
                  group={group}
                  returnTo={returnTo}
                  searchActive={searchActive}
                  stale={stale}
                />
              ),
            )
          : devices.map((device) => (
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
  groupBrowsers = false,
}: {
  title: string;
  devices: readonly ProductDevice[];
  returnTo?: string;
  searchActive: boolean;
  stale?: boolean;
  groupBrowsers?: boolean;
}) {
  const [open, setOpen] = useState(searchActive);
  useEffect(() => {
    setOpen(searchActive);
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
        <CollapsibleContent className="border-t border-border p-3">
          <DeviceSection
            title=""
            devices={devices}
            returnTo={returnTo}
            bordered={false}
            stale={stale}
            groupBrowsers={groupBrowsers}
            searchActive={searchActive}
          />
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}

export function DevicesPage() {
  const { deviceService, browserSpacesService } = useRouteContext({ from: "__root__" });
  const spaces = useQuery({
    queryKey: browserCatalogQueryKey,
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
    // Plugging in a phone should just make it appear.
    refetchInterval: 15_000,
  });

  const catalog = useMemo(
    () => mergeDeviceCatalog(devices.data, spaces.data),
    [devices.data, spaces.data],
  );
  const catalogKnown = devices.data !== undefined || spaces.data !== undefined;
  const visibleDevices = catalog.filter((device) =>
    deviceMatchesCatalogSearch(device, deferredQuery, sites),
  );
  const visibleCount = visibleDevices.length;
  const localBrowsers = visibleDevices.filter(
    (device) =>
      deviceGroup(device) === "Browsers" &&
      isLoopbackBrowserUrl(sites.get(device.id)?.startUrl ?? device.browserUrl),
  );
  const returnFocus = useCollectionReturnFocus("relay:focus:/devices", visibleDevices, "/devices/");

  // Browser navigation owns URL changes; input events own edits. Mirroring
  // both directions in effects lets an old URL overwrite a new or empty edit.
  useEffect(() => {
    setQuery(search.q ?? "");
  }, [search.q]);

  function updateQuery(value: string) {
    setQuery(value);
    void navigate({
      to: "/devices",
      search: {
        ...(value.trim() ? { q: value.trim() } : {}),
        ...(search.returnTo ? { returnTo: search.returnTo } : {}),
      },
    });
  }

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
                <Plus aria-hidden="true" /> New browser
              </Button>
              {!devices.isError ? (
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Check again"
                  title="Check for devices now. Relay also checks every few seconds."
                  onClick={() => void devices.refetch()}
                  disabled={devices.isFetching}
                >
                  <RotateCw
                    className={devices.isFetching ? "animate-spin motion-reduce:animate-none" : ""}
                    aria-hidden="true"
                  />
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
            placeholder="Search by name, platform, or address"
            onChange={updateQuery}
          />
        </div>

        {spaces.isPending && !catalogKnown ? (
          <PageLoading label="Loading Devices and Browsers…" />
        ) : null}
        {devices.isPending && spaces.data !== undefined ? (
          <p role="status" className="mt-3 text-sm text-muted-foreground">
            Checking connected devices…
          </p>
        ) : null}

        <RecordingProblem
          error={!catalogKnown && !spaces.isPending ? (devices.error ?? spaces.error) : null}
          onRetry={() => {
            void devices.refetch();
            void spaces.refetch();
          }}
          retrying={devices.isFetching || spaces.isFetching}
          layout="centered"
        />
        {devices.isError && devices.data === undefined && catalogKnown ? (
          <RecordingProblem
            recovery={{
              title: "Couldn’t check connected devices",
              detail: catalog.some((device) => isBrowser(device))
                ? "Browsers remain available. Check the device connection, then try again."
                : "Check the device connection, then try again.",
              recovery: "",
              retryable: true,
            }}
            onRetry={() => void devices.refetch()}
            retrying={devices.isFetching}
          />
        ) : null}
        {devices.isError && devices.data !== undefined ? (
          <RefreshProblem
            subject={spaces.data !== undefined ? "connected devices" : "devices"}
            onRetry={() => void devices.refetch()}
            retrying={devices.isFetching}
          />
        ) : null}
        {spaces.isError && catalogKnown ? (
          <RecordingProblem
            recovery={{
              title: "Couldn’t refresh browsers",
              detail: "Try loading the browser catalog again.",
              recovery: "",
              retryable: true,
            }}
            onRetry={() => void spaces.refetch()}
            retrying={spaces.isFetching}
          />
        ) : null}

        {catalogKnown &&
        !devices.isPending &&
        !devices.isError &&
        !spaces.isPending &&
        !spaces.isError &&
        catalog.length === 0 ? (
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

        {catalogKnown && catalog.length > 0 && visibleCount === 0 ? (
          <EmptyState
            title="No devices match your search"
            detail="Try another device name or platform."
            action={
              <Button variant="ghost" size="sm" onClick={() => updateQuery("")}>
                Show all devices
              </Button>
            }
          />
        ) : null}

        {visibleCount > 0 ? (
          <div className="mt-3 grid gap-4" aria-live="polite">
            {(["Phones and tablets", "Browsers"] as const).map((title) => {
              const devicesInSection = visibleDevices.filter(
                (device) =>
                  deviceGroup(device) === title &&
                  !(title === "Browsers" && localBrowsers.includes(device)) &&
                  !isNotRunning(device),
              );
              if (title === "Phones and tablets" && !devicesInSection.length && !deferredQuery)
                return (
                  <ConnectDeviceHint
                    key={title}
                    canStartEmulator={visibleDevices.some(isNotRunning)}
                  />
                );
              if (!devicesInSection.length) return null;
              return (
                <DeviceSection
                  key={title}
                  title={title}
                  devices={devicesInSection}
                  stale={title === "Browsers" ? spaces.isError : devices.isError}
                  returnTo={continuation ? search.returnTo : undefined}
                  groupBrowsers={title === "Browsers"}
                  searchActive={Boolean(deferredQuery)}
                />
              );
            })}
            {(() => {
              // Everything you might need occasionally, folded into one quiet area.
              const notRunning = visibleDevices.filter(isNotRunning);
              const scratch = visibleDevices.filter(
                (device) => deviceGroup(device) === "Created by agents",
              );
              const groups = [
                {
                  title: "Not running",
                  devices: notRunning,
                  stale: devices.isError,
                  browsers: false,
                },
                {
                  title: "Local browsers",
                  devices: localBrowsers,
                  stale: spaces.isError,
                  browsers: true,
                },
                {
                  title: "Created by agents",
                  devices: scratch,
                  stale: spaces.isError,
                  browsers: false,
                },
              ].filter((group) => group.devices.length);
              if (!groups.length) return null;
              return (
                <section className="mt-2 grid gap-2" aria-label="More devices and browsers">
                  <h2 className="px-1 text-xs font-medium text-muted-foreground">More</h2>
                  {groups.map((group) => (
                    <AvailableSection
                      key={group.title}
                      title={group.title}
                      devices={group.devices}
                      returnTo={continuation ? search.returnTo : undefined}
                      searchActive={Boolean(deferredQuery)}
                      stale={group.stale}
                      groupBrowsers={group.browsers}
                    />
                  ))}
                </section>
              );
            })()}
          </div>
        ) : null}
      </LibraryPage>
    </BrowserSitesContext.Provider>
  );
}

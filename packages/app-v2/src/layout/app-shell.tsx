/** @jsxImportSource react */
import { SidebarProvider, SidebarTrigger } from "@relay/ui-react/components/sidebar";
import { Button } from "@relay/ui-react/components/button";
import {
  Outlet,
  useLocation,
  useNavigate,
  useRouter,
  type RouterHistory,
} from "@tanstack/react-router";
import { ChevronLeft, ChevronRight, Search } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { classNames } from "../lib/class-names";
import type { Platform } from "../platform/types";
import { parentPathForPath, routeContractForPath } from "../router/route-contract";
import { returnDestination } from "../router/return-destination";
import { ActivityCenterButton } from "./active-work";
import { DeviceDestinationButton } from "./device-destination";
import { RouteAnnouncer } from "./route-announcer";
import { CommandPalette } from "./command-palette";
import { Sidebar } from "./sidebar";
import { MobileNavigation } from "./mobile-navigation";
import {
  historyAvailabilityFlags,
  initialHistoryAvailability,
  updateHistoryAvailability,
} from "./app-shell-history";

export function AppShell({ platform }: { platform: Platform }) {
  const [commandOpen, setCommandOpen] = useState(false);
  const [navigationOpen, setNavigationOpen] = useState(true);
  const commandReturnFocus = useRef<HTMLElement | null>(null);
  const changeCommandOpen = useCallback((open: boolean) => {
    if (open)
      commandReturnFocus.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setCommandOpen(open);
  }, []);
  const location = useLocation();
  const navigate = useNavigate();
  const router = useRouter();
  const historyAvailability = useHistoryAvailability(router.history);
  const routeContract = routeContractForPath(location.pathname);
  const immersive =
    routeContract && "chrome" in routeContract && routeContract.chrome === "immersive";
  const runWorkspace = /^\/runs\/[^/]+$/.test(location.pathname);
  const parentPath = parentPathForPath(location.pathname);
  const source = returnDestination((location.search as Record<string, unknown>).returnTo);
  const canGoBack = historyAvailability.canGoBack || Boolean(source || parentPath);

  function goBack() {
    if (router.history.canGoBack()) {
      router.history.back();
    } else if (source) {
      const { label: _label, ...destination } = source;
      void navigate({ ...destination, replace: true });
    } else if (parentPath) {
      void navigate({ to: parentPath as "/" });
    }
  }

  return (
    <SidebarProvider
      open={navigationOpen}
      onOpenChange={setNavigationOpen}
      className={classNames(" flex h-dvh min-w-0 overflow-hidden bg-sidebar", immersive && "")}
      data-platform={platform.platform}
    >
      <a
        className="bg-primary text-primary-foreground fixed left-1/2 top-2 z-50 inline-flex min-h-11 -translate-x-1/2 -translate-y-[160%] items-center rounded-md px-3 py-2 focus:translate-y-0"
        href="#main-content"
      >
        Skip to content
      </a>
      {!immersive ? <Sidebar /> : null}
      <div
        className={`flex min-h-0 min-w-0 flex-1 flex-col bg-sidebar ${!immersive ? "min-[861px]:pt-14" : ""}`}
      >
        {!immersive ? (
          <header
            className={`${platform.platform === "desktop" ? "pl-20" : "pl-2.5"} [-webkit-app-region:drag] fixed inset-x-0 top-0 z-30 hidden h-14 items-center gap-2 bg-sidebar pr-2.5 py-1.5 min-[861px]:flex`}
            aria-label="Window navigation"
          >
            <SidebarTrigger
              aria-label="Toggle navigation"
              title="Show or hide navigation"
              className="[-webkit-app-region:no-drag] size-8 shrink-0"
            />
            <div className="[-webkit-app-region:no-drag] inline-flex items-center gap-px">
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label="Go back"
                onClick={goBack}
                disabled={!canGoBack}
              >
                <ChevronLeft aria-hidden="true" />
              </Button>
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label="Go forward"
                onClick={() => router.history.forward()}
                disabled={!historyAvailability.canGoForward}
              >
                <ChevronRight aria-hidden="true" />
              </Button>
            </div>
            <button
              type="button"
              className="[-webkit-app-region:no-drag] absolute left-0 inline-flex min-h-9 min-w-56 translate-x-(--command-x) items-center gap-2 rounded-md border border-border bg-card px-2 py-0 pl-2.5 text-left text-xs text-muted-foreground transition-transform duration-200 ease-in-out motion-reduce:transition-none"
              style={
                {
                  "--command-x": navigationOpen
                    ? "calc(var(--sidebar-width) + 12px)"
                    : platform.platform === "desktop"
                      ? "195px"
                      : "123px",
                } as CSSProperties
              }
              onClick={() => changeCommandOpen(true)}
              aria-label="Open command palette"
            >
              <Search className="size-3.5" aria-hidden="true" />
              <span>Search or run a command</span>
              <kbd className="min-w-7 rounded-sm border border-border bg-sidebar px-1.5 py-0.5 text-center text-xs leading-snug text-muted-foreground">
                {modifierKey()} K
              </kbd>
            </button>
            <div className="ml-auto inline-flex items-center gap-0.5">
              {!/^\/tests\/[^/]+$/.test(location.pathname) || location.pathname === "/tests/new" ? (
                <DeviceDestinationButton />
              ) : null}
              <ActivityCenterButton />
            </div>
          </header>
        ) : null}
        <header
          className={[
            "[-webkit-app-region:drag] flex min-h-12 items-center gap-2 border-b border-border bg-background px-2 min-[861px]:hidden",
            platform.platform === "desktop" ? "min-h-[60px] pl-20" : "",
          ].join(" ")}
        >
          <SidebarTrigger className="[-webkit-app-region:no-drag]" aria-label="Open navigation" />
          <Button
            size="icon-sm"
            variant="ghost"
            className="[-webkit-app-region:no-drag] size-9"
            aria-label="Go back"
            onClick={goBack}
            disabled={!canGoBack}
          >
            <ChevronLeft aria-hidden="true" />
          </Button>

          <div className="ml-auto inline-flex items-center">
            {!/^\/tests\/[^/]+$/.test(location.pathname) || location.pathname === "/tests/new" ? (
              <DeviceDestinationButton />
            ) : null}
          </div>
        </header>
        <main
          id="main-content"
          className={classNames(
            " min-h-0 min-w-0 flex-1 bg-card focus:outline-none",
            runWorkspace && "min-[721px]:overflow-hidden [scrollbar-gutter:auto]",
            immersive
              ? "overflow-hidden"
              : "overflow-auto overscroll-contain min-[861px]:mx-2 min-[861px]:mb-2 min-[861px]:rounded-xl [scrollbar-gutter:stable_both-edges]",
          )}
          data-run-workspace={runWorkspace || undefined}
          tabIndex={-1}
        >
          <Outlet />
        </main>
        {!immersive ? <MobileNavigation /> : null}
      </div>
      <RouteAnnouncer />
      <CommandPalette
        open={commandOpen}
        onOpenChange={changeCommandOpen}
        returnFocus={commandReturnFocus}
      />
    </SidebarProvider>
  );
}

function useHistoryAvailability(history: RouterHistory): {
  canGoBack: boolean;
  canGoForward: boolean;
} {
  const initialIndex = history.location.state.__TSR_index;
  const [position, setPosition] = useState(() => initialHistoryAvailability(initialIndex));

  useEffect(
    () =>
      history.subscribe(({ action, location }) => {
        setPosition((current) =>
          updateHistoryAvailability(current, {
            action: action.type,
            index: location.state.__TSR_index,
          }),
        );
      }),
    [history],
  );

  return historyAvailabilityFlags(position);
}

function modifierKey(): string {
  return typeof navigator !== "undefined" && /Mac|iPhone|iPad/u.test(navigator.platform)
    ? "⌘"
    : "Ctrl";
}

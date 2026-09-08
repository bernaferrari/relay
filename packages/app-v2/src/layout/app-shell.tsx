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
import { useCallback, useEffect, useRef, useState } from "react";
import type { Platform } from "../platform/types";
import { parentPathForPath, routeContractForPath } from "../router/route-contract";
import { ActivityCenterButton } from "./active-work";
import { DeviceDestinationButton } from "./device-destination";
import { RouteAnnouncer } from "./route-announcer";
import { CommandPalette } from "./command-palette";
import { Sidebar } from "./sidebar";
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
  const parentPath = parentPathForPath(location.pathname);
  const canGoBack = historyAvailability.canGoBack || Boolean(parentPath);

  function goBack() {
    if (router.history.canGoBack()) {
      router.history.back();
    } else if (parentPath) {
      void navigate({ to: parentPath as "/" });
    }
  }

  return (
    <SidebarProvider
      open={navigationOpen}
      onOpenChange={setNavigationOpen}
      className={`relay-shell flex h-dvh min-w-0 overflow-hidden bg-sidebar${immersive ? " relay-shell--immersive" : ""}`}
      data-platform={platform.platform}
    >
      <a
        className="relay-skip-link fixed left-1/2 top-2 z-[var(--relay-overlay-tooltip)] inline-flex min-h-11 -translate-x-1/2 -translate-y-[160%] items-center rounded-[var(--radius-md)] bg-[var(--button-primary-base)] px-3 py-2 text-[var(--button-primary-foreground)] focus:translate-y-0"
        href="#main-content"
      >
        Skip to content
      </a>
      {!immersive ? <Sidebar /> : null}
      <div
        className={`relay-workspace flex min-h-0 min-w-0 flex-1 flex-col bg-sidebar ${!immersive ? "min-[861px]:pt-[54px]" : ""}`}
      >
        {!immersive ? (
          <header
            className={`${platform.platform === "desktop" ? "pl-[82px]" : "pl-2.5"} relay-desktop-toolbar relay-electron-drag [-webkit-app-region:drag] fixed inset-x-0 top-0 z-30 hidden h-[54px] items-center gap-2 bg-sidebar pr-2.5 py-1.5 min-[861px]:flex`}
            aria-label="Window navigation"
          >
            <SidebarTrigger
              aria-label="Toggle navigation"
              title="Show or hide navigation"
              className="relay-electron-no-drag [-webkit-app-region:no-drag]"
            />
            <div className="relay-history-controls relay-electron-no-drag [-webkit-app-region:no-drag] inline-flex items-center gap-px">
              <Button
                size="icon-sm"
                variant="ghost"
                className="relay-history-button h-8 w-8 border-transparent bg-transparent"
                aria-label="Go back"
                onClick={goBack}
                disabled={!canGoBack}
              >
                <ChevronLeft aria-hidden="true" />
              </Button>
              <Button
                size="icon-sm"
                variant="ghost"
                className="relay-history-button h-8 w-8 border-transparent bg-transparent"
                aria-label="Go forward"
                onClick={() => router.history.forward()}
                disabled={!historyAvailability.canGoForward}
              >
                <ChevronRight aria-hidden="true" />
              </Button>
            </div>
            <button
              type="button"
              className="relay-command-trigger relay-electron-no-drag [-webkit-app-region:no-drag] ml-0 inline-flex min-h-9 min-w-[220px] items-center gap-2 rounded-[var(--radius-md)] border border-[var(--border-weak-base)] bg-[var(--surface-raised-strong)] px-2 py-0 pl-2.5 text-left text-xs text-[var(--text-weaker)]"
              onClick={() => changeCommandOpen(true)}
              aria-label="Open command palette"
            >
              <Search className="size-3.5" aria-hidden="true" />
              <span>Search or run a command</span>
              <kbd className="min-w-7 rounded-[var(--radius-sm)] border border-[var(--border-weak-base)] bg-sidebar px-[5px] py-0.5 text-center text-[10px] leading-[1.4] text-[var(--text-weaker)]">
                {modifierKey()} K
              </kbd>
            </button>
            <div className="ml-auto inline-flex items-center gap-0.5">
              <DeviceDestinationButton />
              <ActivityCenterButton />
            </div>
          </header>
        ) : null}
        <header
          className={[
            "relay-mobile-header relay-electron-drag [-webkit-app-region:drag] flex min-h-12 items-center gap-2 border-b border-[var(--border-weak-base)] bg-[var(--background-base)] px-2 min-[861px]:hidden",
            platform.platform === "desktop" ? "min-h-[60px] pl-[82px]" : "",
          ].join(" ")}
        >
          <SidebarTrigger
            className="relay-mobile-menu relay-electron-no-drag [-webkit-app-region:no-drag]"
            aria-label="Open navigation"
          />
          <Button
            size="icon-sm"
            variant="ghost"
            className="relay-electron-no-drag [-webkit-app-region:no-drag] size-9"
            aria-label="Go back"
            onClick={goBack}
            disabled={!canGoBack}
          >
            <ChevronLeft aria-hidden="true" />
          </Button>

          <div className="ml-auto inline-flex items-center">
            <DeviceDestinationButton />
          </div>
        </header>
        <main
          id="main-content"
          className="relay-main mr-2 mb-2 min-h-0 min-w-0 flex-1 overflow-auto rounded-xl bg-card overscroll-contain [scrollbar-gutter:stable] focus:outline-none"
          tabIndex={-1}
        >
          <Outlet />
        </main>
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

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
import { ArrowLeft, ArrowRight, Search } from "lucide-react";
import { useEffect, useState } from "react";
import type { Platform } from "../platform/types";
import { parentPathForPath, routeContractForPath } from "../router/route-contract";
import { ActivityCenterButton } from "./active-work";
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
      className={`relay-shell${immersive ? " relay-shell--immersive" : ""}`}
      data-platform={platform.platform}
    >
      <a className="relay-skip-link" href="#main-content">
        Skip to content
      </a>
      {!immersive ? <Sidebar /> : null}
      <div className="relay-workspace">
        {!immersive ? (
          <header
            className="relay-desktop-toolbar relay-electron-drag"
            aria-label="Window navigation"
          >
            <div className="relay-history-controls relay-electron-no-drag">
              <Button
                size="icon-sm"
                variant="ghost"
                className="relay-history-button"
                aria-label="Go back"
                onClick={goBack}
                disabled={!canGoBack}
              >
                <ArrowLeft aria-hidden="true" />
              </Button>
              <Button
                size="icon-sm"
                variant="ghost"
                className="relay-history-button"
                aria-label="Go forward"
                onClick={() => router.history.forward()}
                disabled={!historyAvailability.canGoForward}
              >
                <ArrowRight aria-hidden="true" />
              </Button>
            </div>
            <ActivityCenterButton />
            <button
              type="button"
              className="relay-command-trigger relay-electron-no-drag"
              onClick={() => setCommandOpen(true)}
              aria-label="Open command palette"
            >
              <Search aria-hidden="true" />
              <span>Search or run a command</span>
              <kbd>{modifierKey()} K</kbd>
            </button>
          </header>
        ) : null}
        <header className="relay-mobile-header relay-electron-drag">
          <SidebarTrigger
            className="relay-mobile-menu relay-electron-no-drag"
            aria-label="Open navigation"
          />
          <span className="relay-mobile-title">Relay</span>
        </header>
        <main id="main-content" className="relay-main" tabIndex={-1}>
          <Outlet />
        </main>
      </div>
      <RouteAnnouncer />
      <CommandPalette open={commandOpen} onOpenChange={setCommandOpen} />
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

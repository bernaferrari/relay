/** @jsxImportSource react */
import { Dialog } from "@relay/ui-react";
import { Outlet, useLocation } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import type { Platform } from "../platform/types";
import { routeContractForPath } from "../router/route-contract";
import { RouteAnnouncer } from "./route-announcer";
import { Sidebar, SidebarContent } from "./sidebar";

export function AppShell({ platform }: { platform: Platform }) {
  const [navigationOpen, setNavigationOpen] = useState(false);
  const location = useLocation();
  const routeContract = routeContractForPath(location.pathname);
  const immersive =
    routeContract && "chrome" in routeContract && routeContract.chrome === "immersive";

  useEffect(() => setNavigationOpen(false), [location.pathname]);
  useEffect(() => {
    const wideLayout = window.matchMedia("(min-width: 721px)");
    const closeAtWideLayout = (event: MediaQueryListEvent) => {
      if (event.matches) setNavigationOpen(false);
    };
    wideLayout.addEventListener("change", closeAtWideLayout);
    return () => wideLayout.removeEventListener("change", closeAtWideLayout);
  }, []);

  return (
    <Dialog.Root open={navigationOpen} onOpenChange={setNavigationOpen}>
      <div
        className={`relay-shell${immersive ? " relay-shell--immersive" : ""}`}
        data-platform={platform.platform}
      >
        <a className="relay-skip-link" href="#main-content">
          Skip to content
        </a>
        <Sidebar />
        <div className="relay-workspace">
          <header className="relay-mobile-header relay-electron-drag">
            <Dialog.Trigger
              className="relay-icon-button relay-icon-button--small relay-mobile-menu relay-electron-no-drag"
              aria-label="Open navigation"
            >
              <span aria-hidden="true">☰</span>
            </Dialog.Trigger>
            <span className="relay-mobile-title">Relay</span>
          </header>
          <main id="main-content" className="relay-main" tabIndex={-1}>
            <Outlet />
          </main>
        </div>
        <RouteAnnouncer />
      </div>
      <Dialog.Portal>
        <Dialog.Backdrop className="relay-dialog-backdrop relay-navigation-backdrop" />
        <Dialog.Viewport className="relay-dialog-viewport relay-navigation-viewport">
          <Dialog.Popup className="relay-navigation-dialog">
            <Dialog.Title className="relay-visually-hidden">Navigation</Dialog.Title>
            <Dialog.Description className="relay-visually-hidden">
              Choose a Relay workspace area.
            </Dialog.Description>
            <SidebarContent label="Mobile navigation" />
          </Dialog.Popup>
        </Dialog.Viewport>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

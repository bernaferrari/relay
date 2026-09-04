/** @jsxImportSource react */
import { Dialog, IconButton, SidebarProvider } from "@relay/ui-react";
import { Outlet, useLocation, useNavigate, useRouter } from "@tanstack/react-router";
import { ArrowLeft, ArrowRight, PanelLeft } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { Platform } from "../platform/types";
import { parentPathForPath, routeContractForPath } from "../router/route-contract";
import { RouteAnnouncer } from "./route-announcer";
import { Sidebar, SidebarContent } from "./sidebar";

export function AppShell({ platform }: { platform: Platform }) {
  const [navigationOpen, setNavigationOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const router = useRouter();
  const [canGoForward, setCanGoForward] = useState(false);
  const goingBack = useRef(false);
  const routeContract = routeContractForPath(location.pathname);
  const immersive =
    routeContract && "chrome" in routeContract && routeContract.chrome === "immersive";
  const parentPath = parentPathForPath(location.pathname);
  const canGoBack = router.history.canGoBack() || Boolean(parentPath);

  function goBack() {
    if (router.history.canGoBack()) {
      goingBack.current = true;
      router.history.back();
    } else if (parentPath) {
      setCanGoForward(false);
      void navigate({ to: parentPath as "/" });
    }
  }

  useEffect(() => {
    setNavigationOpen(false);
    setCanGoForward(goingBack.current);
    goingBack.current = false;
  }, [location.href]);
  useEffect(() => {
    const wideLayout = window.matchMedia("(min-width: 861px)");
    const closeAtWideLayout = (event: MediaQueryListEvent) => {
      if (event.matches) setNavigationOpen(false);
    };
    wideLayout.addEventListener("change", closeAtWideLayout);
    return () => wideLayout.removeEventListener("change", closeAtWideLayout);
  }, []);

  return (
    <Dialog.Root open={navigationOpen} onOpenChange={setNavigationOpen}>
      <SidebarProvider
        className={`relay-shell${immersive ? " relay-shell--immersive" : ""}`}
        data-platform={platform.platform}
      >
        <a className="relay-skip-link" href="#main-content">
          Skip to content
        </a>
        <Sidebar />
        <div className="relay-workspace">
          {!immersive ? (
            <header
              className="relay-desktop-toolbar relay-electron-drag"
              aria-label="Window navigation"
            >
              <div className="relay-history-controls relay-electron-no-drag">
                <IconButton
                  size="small"
                  aria-label="Go back"
                  onClick={goBack}
                  disabled={!canGoBack}
                >
                  <ArrowLeft aria-hidden="true" />
                </IconButton>
                <IconButton
                  size="small"
                  aria-label="Go forward"
                  onClick={() => {
                    setCanGoForward(false);
                    router.history.forward();
                  }}
                  disabled={!canGoForward}
                >
                  <ArrowRight aria-hidden="true" />
                </IconButton>
              </div>
            </header>
          ) : null}
          <header className="relay-mobile-header relay-electron-drag">
            <Dialog.Trigger
              render={
                <IconButton
                  size="small"
                  className="relay-mobile-menu relay-electron-no-drag"
                  aria-label="Open navigation"
                >
                  <PanelLeft aria-hidden="true" />
                </IconButton>
              }
            />
            <span className="relay-mobile-title">Relay</span>
          </header>
          <main id="main-content" className="relay-main" tabIndex={-1}>
            <Outlet />
          </main>
        </div>
        <RouteAnnouncer />
      </SidebarProvider>
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

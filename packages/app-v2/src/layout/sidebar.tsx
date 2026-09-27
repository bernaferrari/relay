import { classNames } from "../lib/class-names";
import { routeContractForPath } from "../router/route-contract";
/** @jsxImportSource react */
import {
  Sidebar as SharedSidebar,
  SidebarContent as SharedSidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@relay/ui-react/components/sidebar";
import { Link, useLocation } from "@tanstack/react-router";
import { CircleHelp, Settings } from "lucide-react";
import { AppSwitcher } from "./app-switcher";
import { RelayWordmark } from "../components/relay-mark";
import { ReviewCount } from "./review-count";
import { everydayDestinations, utilityDestinations } from "./primary-destinations";

type DestinationItem = (typeof everydayDestinations)[number] | (typeof utilityDestinations)[number];

export function isSidebarItemActive(pathname: string, itemPath: `/${string}`) {
  const sidebar = routeContractForPath(pathname)?.sidebar;
  return sidebar === itemPath.slice(1);
}

/** Destinations that carry the selected App forward in their search. */
const appScopedDestinations: Record<string, true> = {
  "/tests": true,
  "/runs": true,
};

function destinationSearch(item: DestinationItem, app: string | undefined) {
  return app && appScopedDestinations[item.to] ? { app } : {};
}

function SidebarDestinationLink({
  item,
  pathname,
  app,
  onNavigate,
}: {
  item: DestinationItem;
  pathname: string;
  app: string | undefined;
  onNavigate: () => void;
}) {
  const active = isSidebarItemActive(pathname, item.to);
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        render={<Link to={item.to} search={destinationSearch(item, app)} onClick={onNavigate} />}
        isActive={active}
        aria-current={active ? "page" : undefined}
        className={classNames(
          " focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2 flex min-h-9 cursor-pointer items-center gap-2.5 rounded-md px-2.5 text-sm font-medium",
          active
            ? " bg-brand-soft font-semibold text-foreground shadow-none"
            : " text-muted-foreground hover:bg-accent/60 hover:text-foreground",
        )}
      >
        <item.icon
          className={`size-4 shrink-0 ${active ? "text-brand" : "text-muted-foreground"}`}
          aria-hidden="true"
        />
        <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">
          {item.label}
        </span>
        {item.to === "/runs" ? <ReviewCount /> : null}
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

export function SidebarContent({ label = "Primary" }: { label?: string }) {
  const { pathname, search } = useLocation();
  const app = (search as Record<string, unknown>).app;
  const selectedApp = typeof app === "string" ? app : undefined;
  const { isMobile, setOpenMobile } = useSidebar();
  const helpActive = pathname === "/settings/about";
  const settingsActive = pathname.startsWith("/settings/") && !helpActive;
  const closeMobileNavigation = () => {
    if (isMobile) setOpenMobile(false);
  };

  return (
    <SharedSidebarContent className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto overscroll-contain px-3 pb-3 [scrollbar-gutter:auto]">
      <div className="flex h-10 items-center px-2.5 pb-1">
        <Link to="/tests" aria-label="Relay home" onClick={closeMobileNavigation}>
          <RelayWordmark />
        </Link>
      </div>
      <AppSwitcher>
        <nav className="flex flex-col gap-0.5 pt-2" aria-label={label}>
          <SidebarMenu className="m-0 grid list-none gap-0.5 p-0">
            {everydayDestinations.map((item) => (
              <SidebarDestinationLink
                key={item.to}
                item={item}
                pathname={pathname}
                app={selectedApp}
                onNavigate={closeMobileNavigation}
              />
            ))}
          </SidebarMenu>
        </nav>
      </AppSwitcher>
      <div className="my-1.5 border-t border-border/70" role="separator" />
      <SidebarMenu className="m-0 grid list-none gap-0.5 p-0" aria-label="Setup">
        {utilityDestinations.map((item) => (
          <SidebarDestinationLink
            key={item.to}
            item={item}
            pathname={pathname}
            app={selectedApp}
            onNavigate={closeMobileNavigation}
          />
        ))}
      </SidebarMenu>
      <SidebarFooter className="mt-auto pt-2.5">
        <nav
          className="flex flex-col gap-0.5 border-t border-border pt-2.5"
          aria-label={`${label} settings`}
        >
          <SidebarMenuButton
            render={<Link to="/settings/general" onClick={closeMobileNavigation} />}
            isActive={settingsActive}
            className={classNames(
              " focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2 flex min-h-9 cursor-pointer items-center gap-2.5 rounded-md px-2.5 text-sm font-medium",
              settingsActive
                ? " bg-brand-soft font-semibold text-foreground shadow-none"
                : " text-muted-foreground hover:bg-accent/60 hover:text-foreground",
            )}
          >
            <Settings
              className={`size-4 shrink-0 text-muted-foreground${settingsActive ? " text-foreground" : ""}`}
              aria-hidden="true"
            />
            <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">
              Settings
            </span>
          </SidebarMenuButton>
          <SidebarMenuButton
            render={<Link to="/settings/about" onClick={closeMobileNavigation} />}
            isActive={helpActive}
            className=" focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2 flex min-h-9 cursor-pointer items-center gap-2.5 rounded-md px-2.5 text-sm font-medium text-muted-foreground hover:bg-accent/60 hover:text-foreground"
          >
            <CircleHelp className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">Help</span>
          </SidebarMenuButton>
        </nav>
      </SidebarFooter>
    </SharedSidebarContent>
  );
}

export function Sidebar() {
  return (
    <SharedSidebar
      className="border-r-0! hidden h-full w-(--sidebar-width) bg-sidebar min-[861px]:flex"
      aria-label="Relay navigation"
    >
      <SidebarHeader aria-hidden="true" className="h-14 shrink-0 p-0" />
      <SidebarContent />
    </SharedSidebar>
  );
}

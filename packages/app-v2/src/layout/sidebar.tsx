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
import { GitCompare, Settings } from "lucide-react";
import { AppSwitcher } from "./app-switcher";
import { ActiveWork } from "./active-work";
import { primaryDestinations } from "./primary-destinations";

export function isSidebarItemActive(pathname: string, itemPath: `/${string}`) {
  const sidebar = routeContractForPath(pathname)?.sidebar;
  if (itemPath === "/devices") return sidebar === "devices" || sidebar === "sessions";
  return sidebar === itemPath.slice(1);
}

export function SidebarContent({ label = "Primary" }: { label?: string }) {
  const { pathname, search } = useLocation();
  const app = (search as Record<string, unknown>).app;
  const collectionSearch = typeof app === "string" ? { app } : {};
  const { isMobile, setOpenMobile } = useSidebar();
  const settingsActive = pathname.startsWith("/settings/");
  const closeMobileNavigation = () => {
    if (isMobile) setOpenMobile(false);
  };

  return (
    <SharedSidebarContent className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto overscroll-contain px-3 pb-3 [scrollbar-gutter:auto]">
      <AppSwitcher />
      <SidebarGroup className="flex-none pt-1.5">
        <nav className="flex flex-col gap-0.5" aria-label={label}>
          <SidebarMenu className="m-0 grid list-none gap-0.5 p-0">
            {primaryDestinations.map((item) => {
              const active = isSidebarItemActive(pathname, item.to);
              return (
                <SidebarMenuItem key={item.to}>
                  <SidebarMenuButton
                    render={
                      <Link
                        to={item.to}
                        search={item.to === "/devices" ? {} : collectionSearch}
                        onClick={closeMobileNavigation}
                      />
                    }
                    isActive={active}
                    aria-current={active ? "page" : undefined}
                    className={classNames(
                      " focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2 flex min-h-9 cursor-pointer items-center gap-2.5 rounded-md px-2.5 text-sm font-medium text-foreground",
                      active && " bg-accent font-semibold text-foreground shadow-none",
                    )}
                  >
                    <item.icon
                      className={`size-4 shrink-0 text-muted-foreground${active ? " text-foreground" : ""}`}
                      aria-hidden="true"
                    />
                    <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">
                      {item.label}
                    </span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              );
            })}
          </SidebarMenu>
        </nav>
      </SidebarGroup>
      <SidebarFooter className="mt-auto pt-2.5">
        <ActiveWork />
        <nav
          className="flex flex-col gap-0.5 border-t border-border pt-2.5"
          aria-label={`${label} settings`}
        >
          <SidebarMenuButton
            render={<Link to="/changes" onClick={closeMobileNavigation} />}
            isActive={pathname.startsWith("/changes")}
            className={classNames(
              " focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2 flex min-h-9 cursor-pointer items-center gap-2.5 rounded-md px-2.5 text-sm font-medium text-foreground",
              pathname.startsWith("/changes") &&
                " bg-accent font-semibold text-foreground shadow-none",
            )}
          >
            <GitCompare
              className={`size-4 shrink-0 text-muted-foreground${pathname.startsWith("/changes") ? " text-foreground" : ""}`}
              aria-hidden="true"
            />
            <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">Changes</span>
          </SidebarMenuButton>
          <SidebarMenuButton
            render={<Link to="/settings/general" onClick={closeMobileNavigation} />}
            isActive={settingsActive}
            className={classNames(
              " focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2 flex min-h-9 cursor-pointer items-center gap-2.5 rounded-md px-2.5 text-sm font-medium text-foreground",
              settingsActive && " bg-accent font-semibold text-foreground shadow-none",
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

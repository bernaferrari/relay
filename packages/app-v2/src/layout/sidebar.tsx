import { routeContractForPath } from "../router/route-contract";
/** @jsxImportSource react */
import {
  Sidebar as SharedSidebar,
  SidebarContent as SharedSidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@relay/ui-react/components/sidebar";
import { Link, useLocation } from "@tanstack/react-router";
import { FlaskConical, GitCompare, History, MonitorSmartphone, Settings } from "lucide-react";
import { AppSwitcher } from "./app-switcher";
import { ActiveWork } from "./active-work";

const mainItems = [
  { to: "/tests", label: "Tests", icon: FlaskConical },
  { to: "/runs", label: "Runs", icon: History },
  { to: "/devices", label: "Devices", icon: MonitorSmartphone },
] as const;

export function isSidebarItemActive(pathname: string, itemPath: `/${string}`) {
  const sidebar = routeContractForPath(pathname)?.sidebar;
  if (itemPath === "/devices") return sidebar === "devices" || sidebar === "sessions";
  return sidebar === itemPath.slice(1);
}

export function SidebarContent({ label = "Primary" }: { label?: string }) {
  const { pathname } = useLocation();
  const { isMobile, setOpenMobile } = useSidebar();
  const settingsActive = pathname.startsWith("/settings/");
  const closeMobileNavigation = () => {
    if (isMobile) setOpenMobile(false);
  };

  return (
    <SharedSidebarContent className="relay-sidebar-body flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto overscroll-contain px-3 pb-3 [scrollbar-gutter:auto]">
      <AppSwitcher />
      <SidebarGroup className="relay-sidebar-group flex-none pt-1.5">
        <SidebarGroupLabel className="relay-sidebar-section-label min-h-7 px-2.5 pb-1 pt-2 text-[11px] font-semibold text-[var(--text-weaker)]">
          Relay
        </SidebarGroupLabel>
        <nav className="relay-nav flex flex-col gap-0.5" aria-label={label}>
          <SidebarMenu className="relay-sidebar-menu m-0 grid list-none gap-0.5 p-0">
            {mainItems.map((item) => {
              const active = isSidebarItemActive(pathname, item.to);
              return (
                <SidebarMenuItem key={item.to}>
                  <SidebarMenuButton
                    render={<Link to={item.to} onClick={closeMobileNavigation} />}
                    isActive={active}
                    aria-current={active ? "page" : undefined}
                    className={`relay-nav-link focus-visible:outline-2 focus-visible:outline-[var(--relay-focus-ring)] focus-visible:outline-offset-2 flex min-h-9 cursor-pointer items-center gap-2.5 rounded-[var(--radius-md)] px-[11px] text-[13px] font-medium text-[var(--text-base)]${active ? " relay-nav-link--active bg-[var(--surface-base-active)] font-semibold text-[var(--text-strong)] shadow-none" : ""}`}
                  >
                    <item.icon
                      className={`h-[17px] w-[17px] shrink-0 text-[var(--text-weaker)]${active ? " text-[var(--text-strong)]" : ""}`}
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
      <SidebarFooter className="relay-sidebar-footer mt-auto pt-2.5">
        <ActiveWork />
        <nav
          className="relay-nav relay-nav--secondary flex flex-col gap-0.5 border-t border-[var(--border-weak-base)] pt-2.5"
          aria-label={`${label} settings`}
        >
          <SidebarMenuButton
            render={<Link to="/changes" onClick={closeMobileNavigation} />}
            isActive={pathname.startsWith("/changes")}
            className={`relay-nav-link focus-visible:outline-2 focus-visible:outline-[var(--relay-focus-ring)] focus-visible:outline-offset-2 flex min-h-9 cursor-pointer items-center gap-2.5 rounded-[var(--radius-md)] px-[11px] text-[13px] font-medium text-[var(--text-base)]${pathname.startsWith("/changes") ? " relay-nav-link--active bg-[var(--surface-base-active)] font-semibold text-[var(--text-strong)] shadow-none" : ""}`}
          >
            <GitCompare
              className={`h-[17px] w-[17px] shrink-0 text-[var(--text-weaker)]${pathname.startsWith("/changes") ? " text-[var(--text-strong)]" : ""}`}
              aria-hidden="true"
            />
            <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">Changes</span>
          </SidebarMenuButton>
          <SidebarMenuButton
            render={<Link to="/settings/general" onClick={closeMobileNavigation} />}
            isActive={settingsActive}
            className={`relay-nav-link focus-visible:outline-2 focus-visible:outline-[var(--relay-focus-ring)] focus-visible:outline-offset-2 flex min-h-9 cursor-pointer items-center gap-2.5 rounded-[var(--radius-md)] px-[11px] text-[13px] font-medium text-[var(--text-base)]${settingsActive ? " relay-nav-link--active bg-[var(--surface-base-active)] font-semibold text-[var(--text-strong)] shadow-none" : ""}`}
          >
            <Settings
              className={`h-[17px] w-[17px] shrink-0 text-[var(--text-weaker)]${settingsActive ? " text-[var(--text-strong)]" : ""}`}
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

export function Sidebar({ desktop = false }: { desktop?: boolean }) {
  return (
    <SharedSidebar
      className="relay-sidebar hidden h-full min-w-[var(--relay-sidebar-width)] w-[var(--relay-sidebar-width)] bg-[var(--background-weak)] min-[861px]:flex"
      aria-label="Relay navigation"
    >
      <SidebarHeader
        className={`relay-sidebar-head relay-electron-drag [-webkit-app-region:drag] flex min-h-[52px] items-center px-4${desktop ? " min-h-[60px] pl-[82px]" : ""}`}
      >
        <div
          className="relay-brand inline-flex items-center gap-[9px] text-sm font-semibold tracking-[-0.01em]"
          aria-label="Relay"
        >
          <span
            className="relay-brand-mark h-[18px] w-[18px] rounded-[var(--radius-md)] bg-[var(--button-primary-base)] bg-[image:linear-gradient(135deg,transparent_42%,var(--button-primary-foreground)_43%_55%,transparent_56%)] shadow-[var(--shadow-xs)]"
            aria-hidden="true"
          />
          <span>Relay</span>
        </div>
      </SidebarHeader>
      <SidebarContent />
    </SharedSidebar>
  );
}

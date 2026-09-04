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
import {
  FlaskConical,
  GitCompareArrows,
  History,
  House,
  MonitorSmartphone,
  RadioTower,
  Settings,
} from "lucide-react";
import { AppSwitcher } from "./app-switcher";
import { ActiveWork } from "./active-work";

const mainItems = [
  { to: "/home", label: "Home", icon: House },
  { to: "/tests", label: "Tests", icon: FlaskConical },
  { to: "/runs", label: "Runs", icon: History },
  { to: "/sessions", label: "Live", icon: RadioTower },
  { to: "/changes", label: "Changes", icon: GitCompareArrows },
  { to: "/devices", label: "Devices & browsers", icon: MonitorSmartphone },
] as const;

export function isSidebarItemActive(pathname: string, itemPath: (typeof mainItems)[number]["to"]) {
  if (itemPath === "/home") return pathname === itemPath;
  if (itemPath === "/sessions") {
    return pathname.startsWith("/sessions") || pathname.startsWith("/recordings");
  }
  return pathname.startsWith(itemPath);
}

export function SidebarContent({ label = "Primary" }: { label?: string }) {
  const { pathname } = useLocation();
  const { isMobile, setOpenMobile } = useSidebar();
  const settingsActive = pathname.startsWith("/settings/");
  const closeMobileNavigation = () => {
    if (isMobile) setOpenMobile(false);
  };

  return (
    <SharedSidebarContent className="relay-sidebar-body">
      <AppSwitcher />
      <SidebarGroup>
        <SidebarGroupLabel className="relay-sidebar-section-label">Workspace</SidebarGroupLabel>
        <nav className="relay-nav" aria-label={label}>
          <SidebarMenu>
            {mainItems.map((item) => {
              const active = isSidebarItemActive(pathname, item.to);
              return (
                <SidebarMenuItem key={item.to}>
                  <SidebarMenuButton
                    render={<Link to={item.to} onClick={closeMobileNavigation} />}
                    isActive={active}
                    aria-current={active ? "page" : undefined}
                    className={`relay-nav-link${active ? " relay-nav-link--active" : ""}`}
                  >
                    <item.icon aria-hidden="true" />
                    <span>{item.label}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              );
            })}
          </SidebarMenu>
        </nav>
      </SidebarGroup>
      <SidebarFooter className="relay-sidebar-footer">
        <ActiveWork />
        <nav className="relay-nav relay-nav--secondary" aria-label={`${label} settings`}>
          <SidebarMenuButton
            render={<Link to="/settings/general" onClick={closeMobileNavigation} />}
            isActive={settingsActive}
            className={`relay-nav-link${settingsActive ? " relay-nav-link--active" : ""}`}
          >
            <Settings aria-hidden="true" />
            <span>Settings</span>
          </SidebarMenuButton>
        </nav>
      </SidebarFooter>
    </SharedSidebarContent>
  );
}

export function Sidebar() {
  return (
    <SharedSidebar className="relay-sidebar" aria-label="Relay navigation">
      <SidebarHeader className="relay-sidebar-head relay-electron-drag">
        <div className="relay-brand" aria-label="Relay">
          <span className="relay-brand-mark" aria-hidden="true" />
          <span>Relay</span>
        </div>
      </SidebarHeader>
      <SidebarContent />
    </SharedSidebar>
  );
}

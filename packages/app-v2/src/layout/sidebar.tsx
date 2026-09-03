/** @jsxImportSource react */
import { Link, useLocation } from "@tanstack/react-router";
import { AppSwitcher } from "./app-switcher";

const mainItems = [
  { to: "/home", label: "Home" },
  { to: "/changes", label: "Changes" },
  { to: "/tests", label: "Tests" },
  { to: "/runs", label: "Runs" },
  { to: "/devices", label: "Devices" },
] as const;

export function SidebarContent({ label = "Primary" }: { label?: string }) {
  const settingsActive = useLocation().pathname.startsWith("/settings/");

  return (
    <div className="relay-sidebar-body">
      <AppSwitcher />
      <nav className="relay-nav" aria-label={label}>
        {mainItems.map((item) => (
          <Link
            key={item.to}
            to={item.to}
            className="relay-nav-link"
            activeProps={{ className: "relay-nav-link relay-nav-link--active" }}
            activeOptions={{ exact: item.to === "/home" }}
          >
            {item.label}
          </Link>
        ))}
      </nav>
      <nav className="relay-nav relay-nav--secondary" aria-label={`${label} settings`}>
        <Link
          to="/settings/general"
          className={`relay-nav-link${settingsActive ? " relay-nav-link--active" : ""}`}
        >
          Settings
        </Link>
      </nav>
    </div>
  );
}

export function Sidebar() {
  return (
    <aside className="relay-sidebar" aria-label="Relay navigation">
      <div className="relay-sidebar-head relay-electron-drag">
        <div className="relay-brand" aria-label="Relay">
          <span className="relay-brand-mark" aria-hidden="true" />
          <span>Relay</span>
        </div>
      </div>
      <SidebarContent />
    </aside>
  );
}

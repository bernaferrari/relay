/** @jsxImportSource react */
import { Link, useLocation } from "@tanstack/react-router";
import { primaryDestinations } from "./primary-destinations";
import { isSidebarItemActive } from "./sidebar";

/** The same destinations as the sidebar, always reachable on narrow screens. */
export function MobileNavigation() {
  const { pathname, search } = useLocation();
  const app = (search as Record<string, unknown>).app;
  return (
    <nav
      aria-label="Main navigation"
      className="grid shrink-0 grid-cols-4 border-t border-border/60 bg-sidebar px-2 pt-1 pb-[max(0.25rem,env(safe-area-inset-bottom))] min-[861px]:hidden"
    >
      {primaryDestinations.map((item) => {
        const active = isSidebarItemActive(pathname, item.to);
        return (
          <Link
            key={item.to}
            to={item.to}
            search={item.to !== "/devices" && typeof app === "string" ? { app } : {}}
            aria-current={active ? "page" : undefined}
            className={`flex min-h-14 flex-col items-center justify-center gap-1 rounded-lg text-xs transition-colors focus-visible:outline-2 focus-visible:outline-ring motion-reduce:transition-none ${active ? "bg-sidebar-accent text-sidebar-accent-foreground font-semibold" : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground"}`}
          >
            <item.icon className="size-5" strokeWidth={active ? 2 : 1.75} aria-hidden="true" />
            <span>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

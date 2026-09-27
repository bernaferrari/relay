/** @jsxImportSource react */
import { Link, useLocation } from "@tanstack/react-router";
import { everydayDestinations } from "./primary-destinations";
import { useSidebar } from "@relay/ui-react/components/sidebar";
import { Ellipsis } from "lucide-react";
import { isSidebarItemActive } from "./sidebar";

/** The same destinations as the sidebar, always reachable on narrow screens. */
export function MobileNavigation() {
  const { pathname, search } = useLocation();
  const { openMobile, setOpenMobile } = useSidebar();
  const utilityActive = !everydayDestinations.some((item) =>
    isSidebarItemActive(pathname, item.to),
  );
  const app = (search as Record<string, unknown>).app;
  return (
    <nav
      aria-label="Main navigation"
      className="grid shrink-0 grid-cols-3 border-t border-border/60 bg-sidebar px-2 pt-1 pb-[max(0.25rem,env(safe-area-inset-bottom))] min-[861px]:hidden"
    >
      {everydayDestinations.map((item) => {
        const active = isSidebarItemActive(pathname, item.to);
        return (
          <Link
            key={item.to}
            to={item.to}
            search={
              (item.to === "/tests" || item.to === "/runs") && typeof app === "string"
                ? { app }
                : {}
            }
            aria-current={active ? "page" : undefined}
            className={`flex min-h-14 flex-col items-center justify-center gap-1 rounded-lg text-xs transition-colors focus-visible:outline-2 focus-visible:outline-ring motion-reduce:transition-none ${active ? "bg-sidebar-accent text-sidebar-accent-foreground font-semibold" : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground"}`}
          >
            <item.icon className="size-5" strokeWidth={active ? 2 : 1.75} aria-hidden="true" />
            <span>{item.shortLabel}</span>
          </Link>
        );
      })}
      <button
        type="button"
        aria-label="More navigation"
        aria-expanded={openMobile}
        aria-haspopup="dialog"
        onClick={() => setOpenMobile(true)}
        className={`flex min-h-14 flex-col items-center justify-center gap-1 rounded-lg text-xs transition-colors focus-visible:outline-2 focus-visible:outline-ring motion-reduce:transition-none ${utilityActive ? "bg-sidebar-accent text-sidebar-accent-foreground font-semibold" : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground"}`}
      >
        <Ellipsis className="size-5" aria-hidden="true" />
        <span>More</span>
      </button>
    </nav>
  );
}

/** @jsxImportSource react */
import { useRouterState } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { routeContractForPath } from "../router/route-contract";

export function RouteAnnouncer() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const firstRender = useRef(true);
  const title = routeContractForPath(pathname)?.title ?? "Relay";

  useEffect(() => {
    document.title = title === "Relay" ? title : `${title} · Relay`;
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    requestAnimationFrame(() => document.querySelector<HTMLElement>("#main-content")?.focus());
  }, [pathname, title]);

  return (
    <div className="relay-visually-hidden sr-only" aria-live="polite" aria-atomic="true">
      {title}
    </div>
  );
}

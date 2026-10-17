/** @jsxImportSource react */
import { Navigate, useLocation } from "@tanstack/react-router";
import { BrowserWorkspacePage } from "./browser-workspace-page";

/** Browsers live in Devices; this route keeps only the side-by-side views. */
export function EnvironmentsPage(): import("react").ReactElement {
  const search = useLocation({ select: (state) => state.search as Record<string, unknown> });
  if (search.view === "workspace" || search.view === "paired")
    return <BrowserWorkspacePage key={String(search.view)} paired={search.view === "paired"} />;
  return (
    <Navigate
      to="/devices"
      search={{
        ...(search.view === "new" ? { view: "new" } : {}),
        ...(typeof search.returnTo === "string" ? { returnTo: search.returnTo } : {}),
      }}
      replace
    />
  );
}

/** @jsxImportSource react */
import type { RouteContract } from "../router/route-contract";
import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { EmptyState } from "../components/product-patterns";

export function PlaceholderPage({ contract }: { contract: RouteContract }) {
  const state = placeholderState(contract.id);
  return (
    <section className="relay-page" data-route-pattern={contract.pattern}>
      <header className="relay-page-header">
        <p className="relay-eyebrow">{contract.eyebrow}</p>
        <h1>{contract.title}</h1>
        <p className="relay-page-description">{contract.description}</p>
      </header>
      <EmptyState title={state.title} detail={state.detail} action={state.action} />
    </section>
  );
}

function placeholderState(id: RouteContract["id"]): {
  title: string;
  detail: string;
  action?: ReactNode;
} {
  if (id === "/tests") {
    return {
      title: "No saved Tests yet",
      detail: "Record a real journey, review it, and Relay will keep it here for future Runs.",
      action: (
        <Link className="relay-button relay-button--primary relay-button--medium" to="/tests/new">
          Record a Test
        </Link>
      ),
    };
  }
  if (id === "/runs") {
    return {
      title: "No Runs yet",
      detail: "Open a saved Test and choose a ready device or browser to create its first Report.",
      action: (
        <Link className="relay-inline-link" to="/tests">
          Browse Tests
        </Link>
      ),
    };
  }
  if (id === "/devices") {
    return {
      title: "No devices or browsers are ready",
      detail: "Connect a device or start a managed browser. Available options will appear here.",
    };
  }
  if (id === "/apps") {
    return {
      title: "No apps to show",
      detail: "Apps appear here after Relay discovers or connects to a product you can verify.",
    };
  }
  if (id === "/apps/:appId" || id === "/apps/:appId/versions" || id === "/apps/:appId/accounts") {
    return {
      title: "This app view is not ready yet",
      detail:
        "Use Tests, Runs, or Devices to keep working. Relay will not create placeholder app data.",
      action: (
        <Link className="relay-inline-link" to="/apps">
          Back to apps
        </Link>
      ),
    };
  }
  if (id === "/tests/:testId/edit") {
    return {
      title: "Editing is not available here yet",
      detail: "The saved Test is unchanged. Return to Tests to run it or record a new journey.",
      action: (
        <Link className="relay-inline-link" to="/tests">
          Back to Tests
        </Link>
      ),
    };
  }
  return {
    title: "This view is not available yet",
    detail: "There is no saved Relay data for this view. Return to the previous page to continue.",
  };
}

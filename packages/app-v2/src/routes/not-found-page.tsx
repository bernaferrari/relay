/** @jsxImportSource react */
import { Link } from "@tanstack/react-router";

export function NotFoundPage() {
  return (
    <section className="relay-page relay-not-found">
      <p className="relay-eyebrow">Not found</p>
      <h1>This page is not available</h1>
      <p className="relay-page-description">
        Check the address, or return Home to continue in Relay.
      </p>
      <Link className="relay-text-link" to="/home">
        Go to Home
      </Link>
    </section>
  );
}

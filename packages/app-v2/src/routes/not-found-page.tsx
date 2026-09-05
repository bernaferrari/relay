/** @jsxImportSource react */
import { Link } from "@tanstack/react-router";
import { Button } from "@relay/ui-react/components/button";

export function NotFoundPage() {
  return (
    <section className="relay-page relay-not-found">
      <p className="relay-eyebrow">Not found</p>
      <h1>This page is not available</h1>
      <p className="relay-page-description">
        Check the address, or return Home to continue in Relay.
      </p>
      <Button className="mt-6" nativeButton={false} render={<Link to="/home" search={{}} />}>
        Go to Home
      </Button>
    </section>
  );
}

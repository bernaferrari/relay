/** @jsxImportSource react */
import { Button } from "@relay/ui-react/components/button";
import { Link, type ErrorComponentProps } from "@tanstack/react-router";
import { CircleAlert } from "lucide-react";

export function RouteErrorPage({ reset }: ErrorComponentProps) {
  return (
    <section className="relay-page relay-not-found" role="alert">
      <CircleAlert className="mb-4 size-8 text-muted-foreground" aria-hidden="true" />
      <p className="relay-eyebrow">Page unavailable</p>
      <h1>This page could not load</h1>
      <p className="relay-page-description">
        Try loading it again. If this address is out of date, return Home to find your work.
      </p>
      <div className="mt-6 flex flex-wrap gap-3">
        <Button onClick={reset}>Try again</Button>
        <Button variant="outline" nativeButton={false} render={<Link to="/home" search={{}} />}>
          Go to Home
        </Button>
      </div>
    </section>
  );
}

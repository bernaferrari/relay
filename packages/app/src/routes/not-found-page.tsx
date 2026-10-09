/** @jsxImportSource react */
import { Link } from "@tanstack/react-router";
import { Button } from "@relay/ui-react/components/button";
import { Compass } from "lucide-react";

/** Same centred shape as the route error state, inside the app shell. */
export function NotFoundPage() {
  return (
    <section className="flex min-h-full flex-1 items-center justify-center p-8">
      <div className="w-full max-w-sm">
        <Compass className="mb-4 size-5 text-muted-foreground" aria-hidden="true" />
        <h1 className="text-lg font-semibold tracking-tight">This page is not available</h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          The link may be old, or the item was removed. Check the address, or go back to your tests.
        </p>
        <div className="mt-5 flex items-center gap-2">
          <Button size="sm" nativeButton={false} render={<Link to="/tests" />}>
            Go to tests
          </Button>
          <Button size="sm" variant="ghost" onClick={() => window.history.back()}>
            Go back
          </Button>
        </div>
      </div>
    </section>
  );
}

/** @jsxImportSource react */
import { Button } from "@relay/ui-react/components/button";
import { Link, type ErrorComponentProps } from "@tanstack/react-router";
import { RefreshCw } from "lucide-react";

export function RouteErrorPage({ reset }: ErrorComponentProps) {
  return (
    <section className="flex min-h-dvh flex-1 items-center justify-center p-8" role="alert">
      <div className="w-full max-w-sm">
        <RefreshCw className="mb-4 size-5 text-muted-foreground" aria-hidden="true" />
        <h1 className="text-lg font-semibold tracking-tight">This page couldn’t load</h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          Try opening it again, or return to your tests.
        </p>
        <div className="mt-5 flex items-center gap-2">
          <Button size="sm" onClick={reset}>
            Try again
          </Button>
          <Button
            size="sm"
            variant="ghost"
            nativeButton={false}
            render={<Link to="/tests" search={{}} />}
          >
            Back to tests
          </Button>
        </div>
      </div>
    </section>
  );
}

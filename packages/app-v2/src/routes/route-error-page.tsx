/** @jsxImportSource react */
import { Button } from "@relay/ui-react/components/button";
import { Link, type ErrorComponentProps } from "@tanstack/react-router";
import { FormPage, PageHeader } from "../components/page-layout";

export function RouteErrorPage({ reset }: ErrorComponentProps) {
  return (
    <FormPage className="relay-not-found pt-[clamp(72px,14vh,144px)]" role="alert">
      <PageHeader
        context="Page unavailable"
        title="This page could not load"
        description="Try again, or return to Tests to find your work."
        actions={
          <>
            <Button onClick={reset}>Try again</Button>
            <Button
              variant="outline"
              nativeButton={false}
              render={<Link to="/tests" search={{}} />}
            >
              Go to Tests
            </Button>
          </>
        }
      />
    </FormPage>
  );
}

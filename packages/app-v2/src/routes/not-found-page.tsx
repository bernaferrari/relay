/** @jsxImportSource react */
import { Link } from "@tanstack/react-router";
import { Button } from "@relay/ui-react/components/button";
import { FormPage, PageHeader } from "../components/page-layout";

export function NotFoundPage() {
  return (
    <FormPage className="pt-[clamp(72px,14vh,144px)]">
      <PageHeader
        context="Not found"
        title="This page is not available"
        description="Check the address, or return to Tests."
        actions={
          <Button nativeButton={false} render={<Link to="/tests" search={{}} />}>
            Go to Tests
          </Button>
        }
      />
    </FormPage>
  );
}

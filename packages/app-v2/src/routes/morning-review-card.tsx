/** @jsxImportSource react */
import { Button } from "@relay/ui-react/components/button";
import { Card, CardContent } from "@relay/ui-react/components/card";
import { Link } from "@tanstack/react-router";

const steps = [
  {
    href: "/runs",
    label: "Open yesterday’s Result",
    detail: "The grid is Tests × accounts and devices.",
  },
  {
    href: "/runs",
    label: "Read Findings",
    detail: "Confirm is a product issue. Reject is not. Neither accepts a screenshot baseline.",
  },
  {
    href: "/accounts",
    label: "Check Sign-ins",
    detail: "Expired or signed-out accounts fail the next Plan closed as Infra.",
  },
  {
    href: "/tests/new",
    label: "Add a case by recording",
    detail: "Do not write a new YAML library.",
  },
] as const;

export function MorningReviewCard() {
  return (
    <Card className="mb-4 gap-0 py-0" size="sm">
      <CardContent className="space-y-3 py-4">
        <div>
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Morning review
          </p>
          <h2 className="mt-1 text-base font-semibold tracking-tight text-foreground">
            Yesterday’s Plan, then Sign-ins
          </h2>
        </div>
        <ol className="grid list-decimal gap-2 pl-4 text-sm text-muted-foreground">
          {steps.map((step) => (
            <li key={step.label}>
              <Link className="font-medium text-foreground hover:underline" to={step.href}>
                {step.label}
              </Link>
              <p>{step.detail}</p>
            </li>
          ))}
        </ol>
        <Button nativeButton={false} render={<Link to="/runs" />} size="sm" variant="outline">
          Open Results
        </Button>
      </CardContent>
    </Card>
  );
}

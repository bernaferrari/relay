/** @jsxImportSource react */
import { Button } from "@relay/ui-react/components/button";
import { Card, CardContent } from "@relay/ui-react/components/card";
import { useQuery } from "@tanstack/react-query";
import { Link, useRouteContext } from "@tanstack/react-router";
import { settingsQueryKeys } from "../data/settings-product-service";
import { morningAttentionItems } from "./morning-review-attention";

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
    detail:
      "Check live health. Expired or signed-out accounts fail the next Plan closed as Infra. One SuperGrok fixture is not a 3-account pack.",
  },
  {
    href: "/tests/new",
    label: "Add a case by recording",
    detail: "Do not write a new YAML library.",
  },
] as const;

export function MorningReviewCard() {
  const { settingsService } = useRouteContext({ from: "__root__" });
  const apple = useQuery({
    queryKey: settingsQueryKeys.appleSetup,
    queryFn: () => settingsService.appleSetup(),
    staleTime: 30_000,
    retry: false,
  });
  const items = morningAttentionItems({ apple: apple.data });

  return (
    <Card className="mb-4 gap-0 py-0" size="sm">
      <CardContent className="space-y-2.5 py-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Morning review
          </p>
          <h2 className="mt-0.5 text-base font-semibold tracking-tight text-foreground">
            Yesterday’s Plan, then Sign-ins
          </h2>
        </div>
        <ol className="grid list-decimal gap-x-6 gap-y-1.5 pl-4 text-sm text-muted-foreground sm:grid-cols-2">
          {steps.map((step) => (
            <li key={step.label}>
              <Link className="font-medium text-foreground hover:underline" to={step.href}>
                {step.label}
              </Link>
              <p>{step.detail}</p>
            </li>
          ))}
        </ol>
        <div className="rounded-lg border border-border bg-muted/40 px-3 py-2">
          <p className="text-xs font-medium text-foreground">Needs attention on this Mac</p>
          <ul className="mt-1 grid list-disc gap-0.5 pl-4 text-xs leading-snug text-muted-foreground">
            {items.map((item) => (
              <li key={item.id}>
                <Link className="font-medium text-foreground hover:underline" to={item.href}>
                  {item.label}
                </Link>{" "}
                {item.detail}
              </li>
            ))}
          </ul>
        </div>
        <Button nativeButton={false} render={<Link to="/runs" />} size="sm" variant="outline">
          Open Results
        </Button>
      </CardContent>
    </Card>
  );
}

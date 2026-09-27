import { useQuery } from "@tanstack/react-query";
import { Link, useRouteContext } from "@tanstack/react-router";
import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@relay/ui-react/components/button";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@relay/ui-react/components/dropdown-menu";

/** Keep the collection visible while inspecting one member's steps. */
export function TestPlanNavigation({
  testId,
  planId,
  appId,
}: {
  testId: string;
  planId: string;
  appId: string;
}) {
  const { suiteProfileService } = useRouteContext({ from: "__root__" });
  const plan = useQuery({
    queryKey: ["suites", appId, planId],
    queryFn: () => suiteProfileService.getSuite(appId, planId),
  });
  const members = plan.data?.tests ?? [];
  const index = members.findIndex((test) => test.id === testId);
  const search = { plan: planId, planApp: appId, app: appId };
  return (
    <nav
      aria-label="Tests in this plan"
      className="flex min-w-0 flex-wrap items-center gap-3 px-5 pt-3 pb-1"
    >
      <Link
        to="/tests"
        search={{ plan: planId, planApp: appId, app: appId }}
        className="min-w-0 flex-1 basis-48 truncate text-sm text-muted-foreground hover:text-foreground"
        title={plan.data?.name}
      >
        <span className="inline-flex min-w-0 max-w-full items-center gap-1">
          <ChevronLeft className="size-4 shrink-0" aria-hidden="true" />
          <span className="truncate">{plan.data?.name ?? "Back to plan"}</span>
        </span>
      </Link>
      {index >= 0 ? (
        <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger
              render={<Button variant="ghost" size="sm" />}
              aria-label="Test in this plan"
            >
              Test {index + 1} of {members.length}
              <ChevronDown className="size-3.5" aria-hidden="true" />
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              className="max-h-80 w-80 max-w-[calc(100vw-2rem)] overflow-y-auto"
            >
              {members.map((test, position) => (
                <DropdownMenuItem
                  key={test.id}
                  render={<Link to="/tests/$testId" params={{ testId: test.id }} search={search} />}
                  aria-current={test.id === testId ? "page" : undefined}
                >
                  <span className="w-5 shrink-0 text-xs text-muted-foreground tabular-nums">
                    {position + 1}
                  </span>
                  <span className="min-w-0 whitespace-normal">{test.name}</span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          {([-1, 1] as const).map((direction) => {
            const sibling = members[index + direction];
            const label = direction < 0 ? "Previous test" : "Next test";
            return sibling ? (
              <Button
                key={direction}
                nativeButton={false}
                variant="ghost"
                size="icon-sm"
                aria-label={label}
                title={label}
                render={
                  <Link to="/tests/$testId" params={{ testId: sibling.id }} search={search} />
                }
              >
                {direction < 0 ? (
                  <ChevronLeft aria-hidden="true" />
                ) : (
                  <ChevronRight aria-hidden="true" />
                )}
              </Button>
            ) : (
              <Button key={direction} variant="ghost" size="icon-sm" aria-label={label} disabled>
                {direction < 0 ? (
                  <ChevronLeft aria-hidden="true" />
                ) : (
                  <ChevronRight aria-hidden="true" />
                )}
              </Button>
            );
          })}
        </div>
      ) : plan.isError ? (
        <span className="text-xs text-muted-foreground">Could not load the other tests.</span>
      ) : null}
    </nav>
  );
}

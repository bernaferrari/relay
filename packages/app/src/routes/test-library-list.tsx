/** @jsxImportSource react */
import type { ProductTestSummary } from "@relay/product/catalog";
import { Button } from "@relay/ui-react/components/button";
import { Link } from "@tanstack/react-router";
import { Play } from "lucide-react";
import { ReadinessMark } from "../components/product-patterns";
import { StatusPill, runStateOf } from "../components/run-status";
import { libraryRowSurface } from "../components/library-row-styles";
import type { ProductSuite } from "../data/suite-profile-product-service";
import { isTestDraft, testLibraryName, runTime, relativeTime } from "./test-library-presentation";

export function TestLibraryList({
  tests,
  shared,
  bare = false,
  showAppName = true,
  plan,
}: {
  tests: readonly ProductTestSummary[];
  shared: ReadonlySet<string>;
  bare?: boolean;
  showAppName?: boolean;
  plan?: ProductSuite;
}) {
  return (
    <ul
      className={`m-0 grid list-none divide-y divide-border p-0 ${bare ? "" : "overflow-hidden"}`}
    >
      {tests.map((test) => (
        <TestRow
          key={`${test.appMapId}:${test.id}`}
          test={shared.has(test.id) ? { ...test, sharedId: true } : test}
          showAppName={showAppName && !bare}
          plan={plan}
        />
      ))}
    </ul>
  );
}

function TestRow({
  test,
  showAppName,
  plan,
}: {
  test: ProductTestSummary & { sharedId?: boolean };
  showAppName: boolean;
  plan?: ProductSuite;
}) {
  const draft = isTestDraft(test);
  const recent = test.recentRun;
  const state = test.status === "needs-review" ? undefined : runStateOf(recent);
  return (
    <li>
      <div
        className={`group/test-row relative grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 pr-3 ${libraryRowSurface}`}
      >
        <Link
          to="/tests/$testId"
          params={{ testId: test.id }}
          search={{
            ...(test.sharedId ? { app: test.appMapId } : {}),
            ...(plan ? { plan: plan.id, planApp: plan.appMapId } : {}),
          }}
          className="flex min-h-12 min-w-0 flex-wrap items-center justify-between gap-x-4 gap-y-1 py-3 pl-3 focus-visible:relative focus-visible:z-10 focus-visible:outline-2 focus-visible:outline-ring"
          title={`${test.stepCount} ${test.stepCount === 1 ? "step" : "steps"}${recent ? ` · ${relativeTime(runTime(recent))}` : ""}`}
        >
          <span className="grid min-w-0 flex-1 basis-48 gap-0.5">
            <strong className="text-sm font-normal text-foreground text-pretty">
              {testLibraryName(test)}
            </strong>
            <span className="text-xs text-muted-foreground">
              {showAppName ? `${test.appName} · ` : ""}
              {test.stepCount} {test.stepCount === 1 ? "step" : "steps"}
            </span>
          </span>
          <span className="flex min-w-0 items-center text-xs text-muted-foreground [&_[data-slot=status-pill]]:bg-transparent [&_[data-slot=status-pill]]:p-0 [&_[data-slot=badge]]:border-0 [&_[data-slot=badge]]:bg-transparent [&_[data-slot=badge]]:p-0">
            {/* Every draft is unrecorded; the Drafts tab and "Edit draft" already say so. */}
            {draft ? null : test.status !== "ready" ? (
              <ReadinessMark
                status={test.status}
                name={test.name}
                {...(test.setupIssue ? { issue: test.setupIssue } : {})}
              />
            ) : state ? (
              <>
                {test.flaky && state !== "running" ? (
                  <span
                    className="mr-2 rounded-full border border-warning/40 px-1.5 py-0.5 text-xs text-warning-foreground"
                    title="Recent runs keep flipping between passing and failing"
                  >
                    Flaky
                  </span>
                ) : null}
                <StatusPill state={state} />
                {recent && state !== "running" ? (
                  <span className="ml-1.5 w-14 tabular-nums text-muted-foreground/80">
                    · {relativeTime(runTime(recent)).replace(/ ago$/u, "")}
                  </span>
                ) : null}
              </>
            ) : null}
          </span>
        </Link>
        {/* Run appears on hover or focus so names lead the list (always on touch);
            drafts keep their next step visible. */}
        <span
          className={`justify-self-end ${
            test.status === "needs-review" || draft
              ? ""
              : "opacity-0 transition-opacity duration-150 group-hover/test-row:opacity-100 group-focus-within/test-row:opacity-100 [@media(hover:none)]:opacity-100"
          }`}
        >
          <Button
            nativeButton={false}
            variant="ghost"
            size="sm"
            className="min-h-9"
            render={
              test.status === "needs-review" || draft ? (
                <Link
                  to="/tests/$testId/edit"
                  params={{ testId: test.id }}
                  search={test.sharedId ? { app: test.appMapId } : undefined}
                />
              ) : (
                <Link
                  to="/tests/$testId"
                  params={{ testId: test.id }}
                  search={{
                    setup: "run",
                    ...(test.sharedId ? { app: test.appMapId } : {}),
                    ...(plan ? { plan: plan.id, planApp: plan.appMapId } : {}),
                  }}
                />
              )
            }
          >
            {test.status === "needs-review" || draft ? (
              draft ? (
                "Edit draft"
              ) : (
                "Review steps"
              )
            ) : (
              <>
                <Play aria-hidden="true" /> Run
              </>
            )}
          </Button>
        </span>
      </div>
    </li>
  );
}

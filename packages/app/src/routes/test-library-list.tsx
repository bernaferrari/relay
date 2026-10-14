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
  // No reserved slot: on hover the status slides left (still visible) and Run
  // appears beside it. Touch keeps Run in its own column.
  const persistentAction = test.status === "needs-review" || draft;
  return (
    <li>
      <div
        className={`group/test-row relative grid items-center gap-1 pr-3 ${persistentAction ? "grid-cols-[minmax(0,1fr)_auto]" : "grid-cols-[minmax(0,1fr)] [@media(hover:none)]:grid-cols-[minmax(0,1fr)_auto]"} ${libraryRowSurface}`}
      >
        <Link
          to="/tests/$testId"
          params={{ testId: test.id }}
          search={{
            ...(test.sharedId ? { app: test.appMapId } : {}),
            ...(plan ? { plan: plan.id, planApp: plan.appMapId } : {}),
          }}
          className="flex min-h-12 min-w-0 flex-wrap items-center justify-between gap-x-4 gap-y-1 py-3 pl-3 focus-visible:relative focus-visible:z-10 focus-visible:outline-2 focus-visible:outline-ring"
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
          <span
            className={`flex min-w-0 items-center text-xs text-muted-foreground transition-transform duration-200 ease-out motion-reduce:transition-none ${persistentAction ? "" : "group-hover/test-row:-translate-x-9 group-focus-within/test-row:-translate-x-9 [@media(hover:none)]:translate-x-0"} [&_[data-slot=status-pill]]:bg-transparent [&_[data-slot=status-pill]]:p-0 [&_[data-slot=badge]]:border-0 [&_[data-slot=badge]]:bg-transparent [&_[data-slot=badge]]:p-0`}
          >
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
          className={
            persistentAction
              ? "justify-self-end"
              : "pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 opacity-0 transition-opacity duration-200 group-hover/test-row:pointer-events-auto group-hover/test-row:opacity-100 group-focus-within/test-row:pointer-events-auto group-focus-within/test-row:opacity-100 [@media(hover:none)]:pointer-events-auto [@media(hover:none)]:static [@media(hover:none)]:translate-y-0 [@media(hover:none)]:justify-self-end [@media(hover:none)]:opacity-100"
          }
        >
          <Button
            nativeButton={false}
            variant="ghost"
            size={persistentAction ? "sm" : "icon-sm"}
            className={persistentAction ? "min-h-9" : undefined}
            {...(persistentAction ? {} : { "aria-label": `Run ${test.name}`, title: "Run" })}
            render={
              test.status === "needs-review" || draft ? (
                <Link
                  to="/tests/$testId"
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
            {persistentAction ? draft ? "Edit draft" : "Review steps" : <Play aria-hidden="true" />}
          </Button>
        </span>
      </div>
    </li>
  );
}

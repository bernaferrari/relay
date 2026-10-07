/** @jsxImportSource react */
import { useId } from "react";
import { Link } from "@tanstack/react-router";
import type { ProductSuiteIssue, ProductSuiteTest } from "../data/suite-profile-product-service";

/** Canonical preflight determines usage. This surface only presents its finding
 * and opens the existing Test editor; it never changes recorded text. */
export function PlanInputUsageWarnings({
  issues,
  tests,
  appId,
}: {
  issues: readonly ProductSuiteIssue[];
  tests: readonly ProductSuiteTest[];
  appId: string;
}) {
  const id = useId();
  if (!issues.length) return null;
  return (
    <section
      aria-labelledby={id}
      className="mt-5 grid gap-2 rounded-lg border border-border bg-muted/30 p-4"
    >
      <h2 id={id} className="text-sm font-medium">
        Prompts aren’t connected
      </h2>
      {issues.map((issue) => (
        <p key={issue.message} className="text-sm leading-6 text-muted-foreground">
          {issue.message}
        </p>
      ))}
      <details className="text-sm text-muted-foreground">
        <summary className="w-fit cursor-pointer py-3 underline underline-offset-4">
          How to connect
        </summary>
        <p className="mt-1 leading-6">
          Open a text step and choose Text source → Run input. Enter the input name above and save.
          If the Test has no text step, record one first.
        </p>
      </details>
      <div className="flex flex-wrap gap-x-4 gap-y-2">
        {tests.map((test) => (
          <Link
            key={test.id}
            to="/tests/$testId"
            params={{ testId: test.id }}
            search={{ app: appId }}
            className="inline-flex min-h-11 items-center text-sm font-medium underline underline-offset-4"
          >
            Connect input in {test.name}
          </Link>
        ))}
      </div>
    </section>
  );
}

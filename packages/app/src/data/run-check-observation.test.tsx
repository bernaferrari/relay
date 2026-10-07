/** @jsxImportSource react */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { EmbeddedRunResult } from "../components/embedded-run-result";
import { projectRunReport } from "./run-product-service";

const checkId = "start-conversation";
const cause =
  "screen-inspection-unavailable: accessibility inspection unavailable; screen identity unproven (expected “Grok home”)";
const warning =
  "warn: optional UI-tree capture failed: optional accessibility snapshot exceeded 500ms";
function check(data: Record<string, unknown>) {
  return { kind: "campaign-check-result", data: { id: checkId, ...data } };
}
function project(artifacts: unknown[]) {
  return projectRunReport(
    "source-check-failed",
    {
      outcome: "harness-failure",
      error: "Native current-action response requires a verified initiating boundary",
      artifacts,
      steps: [
        {
          id: "source-capture",
          title: `Capture for review · step:${checkId}:Start a new conversation`,
          status: "ok",
          log: warning,
          frames: [{ path: "frames/source.png" }],
        },
      ],
      frames: [
        {
          path: "frames/source.png",
          caption: "Start a new conversation",
          mime: "image/png",
          base64: "iVBORw0KGgo=",
        },
      ],
    },
    { channels: { screenshot: { entries: 1 } } },
  );
}

it("shows the matched failed source check beside its captured image while retaining the optional capture log", () => {
  const report = project([
    check({ status: "failed", primaryError: cause, error: "Later check wrapper failed" }),
  ]);
  expect(report.timeline[0]).toMatchObject({
    state: "failed",
    observed: cause,
    log: warning,
    framePaths: ["frames/source.png"],
  });
  expect(report.technicalCause).toBe(
    "Native current-action response requires a verified initiating boundary",
  );
  const client = new QueryClient();
  try {
    const html = renderToStaticMarkup(
      <QueryClientProvider client={client}>
        <EmbeddedRunResult report={report} />
      </QueryClientProvider>,
    );
    expect(html).toContain("Observed:");
    expect(html).toContain("screen-inspection-unavailable:");
    expect(html).toContain('src="data:image/png;base64,iVBORw0KGgo="');
    expect(html).not.toContain(warning);
  } finally {
    client.clear();
  }
});

it("uses the matched failed check's error when no primary error was retained", () => {
  expect(project([check({ status: "failed", error: cause })]).timeline[0]?.observed).toBe(cause);
});

it.each([
  { status: "blocked", error: "No input dispatched: starting screen unproven" },
  { status: "blocked", dependencyReason: "Starting screen remains unproven" },
])("shows the exact blocked check reason: %o", (data) => {
  expect(project([check(data)]).timeline[0]).toMatchObject({
    state: "blocked",
    observed: data.error ?? data.dependencyReason,
    log: warning,
  });
});

it("does not borrow a different check's failure by title or artifact order", () => {
  const report = project([check({ id: "another-check", status: "failed", error: cause })]);
  expect(report.timeline[0]).toMatchObject({ state: "passed", observed: warning, log: warning });
});

it("does not choose one failure from repeated check IDs without exact occurrence attribution", () => {
  const report = project([
    check({ status: "failed", error: cause }),
    check({ status: "failed", error: "Another occurrence failed differently" }),
  ]);
  expect(report.timeline[0]?.observed).toBe(warning);
});

it("preserves successful and legacy trace observations without treating retained error fields as a failed check", () => {
  expect(project([check({ status: "passed", error: cause })]).timeline[0]).toMatchObject({
    state: "passed",
    observed: warning,
    log: warning,
  });
  expect(project([]).timeline[0]).toMatchObject({
    state: "passed",
    observed: warning,
    log: warning,
  });
});

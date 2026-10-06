import { createHash } from "node:crypto";
import { formatCaptureReviewCoverageSummary, runPanelManifestSchema } from "@relay/protocol";
import type { OperationInvoker } from "./server.js";

const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const text = (value: unknown, fallback = ""): string =>
  typeof value === "string" ? value.slice(0, 240) : fallback;
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const count = (value: unknown) =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : 0;

export type RelayPanelInput = {
  appMapId?: string;
  runId?: string;
  frameIndex?: number;
  view?: "catalog" | "run" | "frame";
  requestId?: string;
};

/** Execution, check outcome, and human acceptance are independent facts. */
export function panelRunPresentation(value: unknown) {
  const run = object(value);
  const coverage = object(run.coverage ?? run.captureSummary);
  const review = object(run.review);
  const execution =
    (
      {
        queued: "Queued",
        running: "Running",
        paused: "Paused",
        ok: "Completed",
        healed: "Completed after repair",
        error: "Execution failed",
        failed: "Execution failed",
        cancelled: "Cancelled",
        blocked: "Blocked",
      } as Record<string, string>
    )[text(run.status)] ?? text(run.status, "Unknown execution");
  const outcome =
    (
      {
        passed: "Checks passed",
        "product-failure": "Product check failed",
        "harness-failure": "Could not verify",
        uncertain: "Needs review",
        cancelled: "Cancelled",
      } as Record<string, string>
    )[text(run.outcome)] ?? "Check outcome not reported";
  const pending = count(coverage.pending);
  const awaitingReview = pending > 0 || review.status === "pending";
  return {
    execution,
    outcome,
    label: `${execution}${awaitingReview ? " · awaiting review" : ""}`,
    awaitingReview,
  };
}

/** No device control. Catalog, bounded Run metadata, and one image are separate reads. */
export async function readRelayPanel(
  invoker: OperationInvoker,
  scope: { projectId: string },
  input: RelayPanelInput,
  signal: AbortSignal,
) {
  const issues: string[] = [];
  const view = input.view ?? "catalog";
  const read = async (
    id: Parameters<OperationInvoker["invoke"]>[0],
    args: Record<string, unknown>,
  ) => {
    try {
      return object(await invoker.invoke(id, args, { signal }));
    } catch {
      issues.push(`Could not read ${id}. Check Relay connection and project access.`);
      return {};
    }
  };
  const state: Record<string, unknown> = {
    schemaVersion: 1,
    projectId: scope.projectId,
    readOnly: true,
    view,
    ...(input.requestId ? { requestId: input.requestId } : {}),
    appMapId: input.appMapId,
    runId: input.runId,
    frameIndex: input.frameIndex,
    issues,
  };
  if (view === "catalog") {
    const catalog = await read("app-map.list", {});
    const allApps = list(catalog.appMaps);
    const apps = allApps.slice(0, 30).map((value) => {
      const app = object(value);
      return {
        id: text(app.id),
        name: text(app.name ?? app.title, text(app.id)),
        revision: app.revision,
      };
    });
    const appMapId = input.appMapId ?? (allApps.length === 1 ? apps[0]?.id : undefined);
    const map = appMapId ? object((await read("app-map.get", { appMapId })).appMap) : {};
    const allTests = Object.entries(object(map.tests));
    const tests = allTests.slice(0, 60).map(([id, value]) => {
      const test = object(value);
      return { id, name: text(test.name, id), stepCount: list(test.steps).length };
    });
    const response = await read("run.list", { limit: 12, ...(appMapId ? { appMapId } : {}) });
    const runs = list(response.runs)
      .slice(0, 12)
      .map((value) => {
        const run = object(value);
        const summary = object(run.captureSummary);
        return {
          id: text(run.id),
          name: text(run.title ?? run.action, "Run"),
          status: text(run.status, "unknown"),
          outcome: text(run.outcome),
          presentation: panelRunPresentation(run),
          captureSummary: Object.fromEntries(
            ["captured", "missing", "pending", "accepted", "issue", "needMoreEvidence"].map(
              (key) => [key, count(summary[key])],
            ),
          ),
        };
      });
    Object.assign(state, {
      apps,
      appMapId,
      tests,
      runs,
      catalog: {
        apps: {
          shown: apps.length,
          totalCount: allApps.length,
          truncated: allApps.length > apps.length,
        },
        tests: {
          shown: tests.length,
          totalCount: allTests.length,
          truncated: allTests.length > tests.length,
        },
        runs: {
          shown: runs.length,
          totalCount: response.totalCount,
          nextCursor: text(response.nextCursor),
          truncated: Boolean(response.nextCursor) || list(response.runs).length > 12,
        },
      },
    });
    if (allApps.length > 30)
      issues.push(
        `Showing 30 of ${allApps.length} Apps. Select another App by its exact id in chat.`,
      );
    if (allTests.length > 60) issues.push(`Showing 60 of ${allTests.length} saved Tests.`);
    if (response.nextCursor)
      issues.push("Showing the 12 most recent Runs. Select an older Run by its exact id in chat.");
  }
  let frame:
    | { runId: string; index: number; count: number; imageSha256: string; content: string }
    | undefined;
  if (input.runId) {
    const index = input.frameIndex ?? 0;
    const response = await read("run.panel-manifest.get", {
      runId: input.runId,
      offset: index,
      limit: view === "frame" ? 1 : 40,
    });
    const parsed = runPanelManifestSchema.safeParse(response.manifest);
    if (!parsed.success || parsed.data.run.id !== input.runId)
      issues.push("This Run is unavailable in the current project.");
    else {
      const manifest = parsed.data;
      Object.assign(state, {
        selectedRun: {
          ...manifest.run,
          coverage: manifest.coverage,
          coverageLine: formatCaptureReviewCoverageSummary(manifest.coverage),
          checks: manifest.checks,
          presentation: panelRunPresentation({ ...manifest.run, coverage: manifest.coverage }),
        },
        manifest: manifest.frames,
      });
      const entry = manifest.frames.items.find((item) => item.index === index);
      state.frameIndex = index;
      state.frameCount = manifest.frames.totalCount;
      if (manifest.frames.truncated && view !== "frame")
        issues.push(
          `This page contains ${manifest.frames.items.length} of ${manifest.frames.totalCount} capture obligations. Next and Previous load one selected frame.`,
        );
      if (!entry)
        issues.push(
          manifest.frames.totalCount
            ? "This capture index is outside the retained Run manifest."
            : "This Run has no retained screenshots.",
        );
      else if (entry.blocked)
        issues.push("This planned capture is blocked. No screenshot is substituted.");
      else if (!entry.file || !entry.imageSha256 || entry.status === "missing")
        issues.push(
          "This planned screenshot is missing or has no recorded digest. No screenshot is substituted.",
        );
      else if (input.frameIndex !== undefined || view !== "catalog") {
        if (!invoker.binaryResource)
          issues.push("This Relay connection cannot read retained screenshot bytes.");
        else {
          try {
            const result = await invoker.binaryResource(
              `/runs/${encodeURIComponent(input.runId)}/frames/${encodeURIComponent(entry.file)}?maxBytes=2000000`,
              { signal },
              2_000_000,
            );
            const bytes = Buffer.from(result.bytes);
            if (bytes.length > 2_000_000)
              issues.push("This captured screenshot exceeds the 2 MB display limit.");
            else {
              const digest = createHash("sha256").update(bytes).digest("hex");
              if (
                !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
                digest !== entry.imageSha256
              )
                issues.push("This captured screenshot failed integrity verification.");
              else
                frame = {
                  runId: input.runId,
                  index,
                  count: manifest.frames.totalCount,
                  imageSha256: digest,
                  content: bytes.toString("base64"),
                };
            }
          } catch (error) {
            issues.push(
              error instanceof Error && /byte limit|display limit/.test(error.message)
                ? "This captured screenshot exceeds the 2 MB display limit."
                : "This captured screenshot is unavailable or failed integrity verification. Refresh this Run to try again.",
            );
          }
        }
      }
    }
  }
  return { state, ...(frame ? { frame } : {}) };
}

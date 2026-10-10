/** Plain-text tables and verdicts for people at a terminal. JSON stays raw. */
import { readinessFromDiscovery } from "./test-discovery.js";

export type VerdictStep = {
  id: string;
  title: string;
  kind?: "action" | "check";
  status: "passed" | "failed" | "not-run";
  expected?: string;
  saw?: string;
  screenshot?: string;
};

export type Verdict = {
  runId: string;
  title: string;
  status: "passed" | "failed" | "blocked" | "cancelled" | "running";
  summary: string;
  reason?: string;
  durationMs?: number;
  device?: string;
  steps: VerdictStep[];
};

function cell(value: unknown, max = 60): string {
  const text = value === undefined || value === null ? "" : String(value).replace(/\s+/gu, " ");
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

export function table(headers: readonly string[], rows: readonly (readonly unknown[])[]): string {
  const cells = [
    headers.map((header) => cell(header)),
    ...rows.map((row) => row.map((value) => cell(value))),
  ];
  const widths = headers.map((_, column) =>
    Math.max(...cells.map((row) => (row[column] ?? "").length)),
  );
  return cells
    .map((row) =>
      row
        .map((value, column) => (column === row.length - 1 ? value : value.padEnd(widths[column]!)))
        .join("  ")
        .trimEnd(),
    )
    .join("\n");
}

export function age(timestamp: unknown, now = Date.now()): string {
  if (typeof timestamp !== "number" || !Number.isFinite(timestamp)) return "";
  const seconds = Math.max(0, Math.round((now - timestamp) / 1000));
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86_400)}d ago`;
}

export function duration(ms: unknown): string {
  if (typeof ms !== "number" || !Number.isFinite(ms) || ms < 0) return "";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60_000);
  return `${minutes}m ${String(Math.round((ms % 60_000) / 1000)).padStart(2, "0")}s`;
}

const statusWord: Record<Verdict["status"], string> = {
  passed: "PASSED",
  failed: "FAILED",
  blocked: "BLOCKED",
  cancelled: "CANCELLED",
  running: "RUNNING",
};

const statusMark: Record<Verdict["status"], string> = {
  passed: "✓",
  failed: "✗",
  blocked: "!",
  cancelled: "-",
  running: "…",
};

function stepDetail(step: VerdictStep, index: number): string[] {
  const lines = [`Step ${index + 1} · ${step.title}`];
  if (step.expected) lines.push(`  Expected:   ${step.expected}`);
  if (step.saw) lines.push(`  Saw:        ${step.saw}`);
  if (step.screenshot) lines.push(`  Screenshot: ${step.screenshot}`);
  return lines;
}

export function formatVerdict(verdict: Verdict): string {
  const meta = [duration(verdict.durationMs), verdict.device].filter(Boolean).join(" · ");
  const lines = [
    `${statusMark[verdict.status]} ${statusWord[verdict.status]}  ${verdict.title}${meta ? `  (${meta})` : ""}`,
    verdict.summary,
  ];
  if (verdict.reason && verdict.reason !== verdict.summary) lines.push(`Why: ${verdict.reason}`);
  if (verdict.steps.length) {
    lines.push(
      "",
      table(
        ["#", "STEP", "RESULT"],
        verdict.steps.map((step, index) => [
          index + 1,
          step.title,
          step.status === "failed" ? "FAILED" : step.status === "not-run" ? "not run" : "passed",
        ]),
      ),
    );
  }
  const failing = verdict.steps
    .map((step, index) => ({ step, index }))
    .filter(({ step }) => step.status === "failed" || step.expected || step.saw);
  for (const { step, index } of failing) lines.push("", ...stepDetail(step, index));
  if (verdict.runId) lines.push("", `Run: ${verdict.runId}  (relay inspect ${verdict.runId})`);
  return lines.join("\n");
}

export type CiTotals = {
  total: number;
  passed: number;
  failed: number;
  blocked: number;
  cancelled: number;
  skipped: number;
};

export type CiSkipped = { testId: string; name: string; reason: string };

export function formatCiReport(input: {
  app: string;
  verdicts: readonly Verdict[];
  skipped: readonly CiSkipped[];
  totals: CiTotals;
}): string {
  const lines = [
    `Relay CI · ${input.app}`,
    "",
    table(
      ["RESULT", "TEST", "TIME", "SUMMARY"],
      [
        ...input.verdicts.map((verdict) => [
          `${statusMark[verdict.status]} ${verdict.status}`,
          verdict.title,
          duration(verdict.durationMs),
          verdict.summary,
        ]),
        ...input.skipped.map((skip) => ["  skipped", skip.name, "", skip.reason]),
      ],
    ),
  ];
  for (const verdict of input.verdicts) {
    if (verdict.status === "passed") continue;
    const failing = verdict.steps
      .map((step, index) => ({ step, index }))
      .filter(({ step }) => step.status === "failed");
    if (!failing.length && !verdict.reason) continue;
    lines.push("", `${statusMark[verdict.status]} ${verdict.title}`);
    if (verdict.reason) lines.push(`  ${verdict.reason}`);
    for (const { step, index } of failing)
      lines.push(...stepDetail(step, index).map((line) => `  ${line}`));
  }
  const { totals } = input;
  lines.push(
    "",
    [
      `${totals.passed} passed`,
      `${totals.failed} failed`,
      `${totals.blocked} blocked`,
      ...(totals.cancelled ? [`${totals.cancelled} cancelled`] : []),
      ...(totals.skipped ? [`${totals.skipped} skipped (not ready)`] : []),
    ].join(" · "),
  );
  return lines.join("\n");
}

function xml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function ciJunit(input: {
  app: string;
  verdicts: readonly Verdict[];
  skipped: readonly CiSkipped[];
  totals: CiTotals;
}): string {
  const seconds = (ms: number | undefined) => ((ms ?? 0) / 1000).toFixed(3);
  const time = input.verdicts.reduce((sum, verdict) => sum + (verdict.durationMs ?? 0), 0);
  const cases = [
    ...input.verdicts.map((verdict) => {
      const open = `    <testcase classname="${xml(input.app)}" name="${xml(verdict.title)}" time="${seconds(verdict.durationMs)}">`;
      const failing = verdict.steps.find((step) => step.status === "failed");
      const detail = [
        verdict.summary,
        verdict.reason,
        failing?.expected ? `Expected: ${failing.expected}` : undefined,
        failing?.saw ? `Saw: ${failing.saw}` : undefined,
        failing?.screenshot ? `Screenshot: ${failing.screenshot}` : undefined,
        verdict.runId ? `Run: ${verdict.runId}` : undefined,
      ]
        .filter(Boolean)
        .join("\n");
      const body =
        verdict.status === "passed"
          ? ""
          : verdict.status === "failed"
            ? `\n      <failure message="${xml(verdict.summary)}">${xml(detail)}</failure>\n    `
            : `\n      <error type="${verdict.status}" message="${xml(verdict.summary)}">${xml(detail)}</error>\n    `;
      return `${open}${body}</testcase>`;
    }),
    ...input.skipped.map(
      (skip) =>
        `    <testcase classname="${xml(input.app)}" name="${xml(skip.name)}" time="0"><skipped message="${xml(skip.reason)}"/></testcase>`,
    ),
  ];
  const errors = input.totals.blocked + input.totals.cancelled;
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<testsuites name="relay" tests="${input.totals.total}" failures="${input.totals.failed}" errors="${errors}" skipped="${input.totals.skipped}" time="${seconds(time)}">`,
    `  <testsuite name="${xml(input.app)}" tests="${input.totals.total}" failures="${input.totals.failed}" errors="${errors}" skipped="${input.totals.skipped}" time="${seconds(time)}">`,
    ...cases,
    `  </testsuite>`,
    `</testsuites>`,
    "",
  ].join("\n");
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function runResult(run: Record<string, unknown>): string {
  switch (run.outcome) {
    case "passed":
      return "passed";
    case "product-failure":
      return "failed";
    case "harness-failure":
    case "uncertain":
      return "blocked";
    case "cancelled":
      return "cancelled";
    default:
      return typeof run.status === "string" ? run.status : "";
  }
}

/** Tables for the list commands (apps, tests, runs, devices) in human mode. */
export function formatListResult(result: unknown, now = Date.now()): string | undefined {
  const value = record(result);
  if (!value) return undefined;
  if (Array.isArray(value.appMaps)) {
    const apps = value.appMaps.map(record).filter((app) => app !== undefined);
    if (!apps.length)
      return 'No apps yet. Create a Test with: relay new "<what should work>" --url <website>';
    const withTests = apps.some((app) => typeof app.testCount === "number");
    return table(
      ["NAME", ...(withTests ? ["TESTS"] : ["SCREENS"]), "UPDATED", "ID"],
      apps.map((app) => [
        app.name ?? app.id,
        withTests ? app.testCount : record(app.counts)?.screens,
        age(app.updatedAt, now),
        app.id,
      ]),
    );
  }
  if (Array.isArray(value.tests) && record(value.discovery)?.scope === "saved-recordings") {
    const tests = value.tests.map(record).filter((test) => test !== undefined);
    if (!tests.length)
      return 'No Tests in this app yet. Create one with: relay new "<what should work>"';
    return table(
      ["NAME", "STATUS", "STEPS", "ID"],
      tests.map((test) => [
        test.name ?? test.id,
        readinessFromDiscovery(record(test.discovery) ?? {}).label,
        test.stepCount,
        test.id,
      ]),
    );
  }
  if (Array.isArray(value.runs)) {
    const runs = value.runs.map(record).filter((run) => run !== undefined);
    if (!runs.length) return "No runs yet.";
    const total = typeof value.totalCount === "number" ? value.totalCount : runs.length;
    return [
      table(
        ["RESULT", "TITLE", "WHEN", "TIME", "ID"],
        runs.map((run) => [
          runResult(run),
          run.title ?? run.action,
          age(run.finishedAt ?? run.startedAt ?? run.queuedAt, now),
          duration(run.durationMs),
          run.id,
        ]),
      ),
      ...(total > runs.length ? [`Showing ${runs.length} of ${total} runs.`] : []),
    ].join("\n");
  }
  if (Array.isArray(value.devices)) {
    const devices = value.devices.map(record).filter((device) => device !== undefined);
    const hidden =
      typeof value.hiddenUnavailableCount === "number" ? value.hiddenUnavailableCount : 0;
    if (!devices.length)
      return "No devices connected. Start a simulator or emulator, or plug in a phone.";
    return [
      table(
        ["NAME", "PLATFORM", "KIND", "ID"],
        devices.map((device) => [
          device.name,
          device.platform,
          device.kind,
          device.serial ?? device.id,
        ]),
      ),
      ...(hidden ? [`${hidden} unavailable device${hidden === 1 ? "" : "s"} hidden.`] : []),
    ].join("\n");
  }
  return undefined;
}

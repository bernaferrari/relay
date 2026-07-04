/**
 * Structured job reports for CI (JSON / JUnit) and product surfaces.
 */
import type { JobStatus, TestJob } from "./session.js";
import type { Glyph, StepKind } from "./trace.js";

const LOG_TAIL_CHARS = 2_000;

export type JobReportStep = {
  id: string;
  title: string;
  kind: StepKind;
  status: string;
  durationMs?: number;
  glyphs: Glyph[];
  log: string;
};

export type JobReport = {
  id: string;
  action: string;
  title: string;
  status: JobStatus;
  serial?: string;
  deviceName?: string;
  platform: string;
  attempts: number;
  healed: boolean;
  healMessage?: string;
  error?: string;
  errorCode?: string;
  startedAt: number;
  finishedAt?: number;
  durationMs?: number;
  steps: JobReportStep[];
  frameCount: number;
  runDir?: string;
  /** CI convenience: true when status is ok or healed */
  ok: boolean;
};

function logTail(log: string, max = LOG_TAIL_CHARS): string {
  if (log.length <= max) return log;
  return `…${log.slice(-max)}`;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function toJobReport(job: TestJob): JobReport {
  const startedAt = job.startedAt ?? job.queuedAt;
  const durationMs = job.finishedAt != null ? job.finishedAt - startedAt : undefined;
  const healed = Boolean(job.healed || job.status === "healed");
  const ok = (job.status === "ok" || healed) && job.status !== "cancelled";

  return {
    id: job.id,
    action: job.action,
    title: job.title,
    status: job.status,
    serial: job.serial,
    deviceName: job.deviceName,
    platform: job.platform ?? "android",
    attempts: job.attempts,
    healed,
    healMessage: job.healMessage,
    error: job.error,
    errorCode: job.errorCode,
    startedAt,
    finishedAt: job.finishedAt,
    durationMs,
    steps: job.steps.map((s) => ({
      id: s.id,
      title: s.title,
      kind: s.kind,
      status: s.status ?? "running",
      durationMs: s.durationMs,
      glyphs: s.glyphs,
      log: logTail(s.log),
    })),
    frameCount: job.frames.length,
    runDir: job.runDir,
    ok,
  };
}

export function reportPassed(report: JobReport): boolean {
  return report.ok;
}

export function toJunitXml(reports: JobReport[]): string {
  const tests = reports.length;
  let failures = 0;
  let totalTimeSec = 0;

  const cases = reports.map((r) => {
    const timeSec = (r.durationMs ?? 0) / 1000;
    totalTimeSec += timeSec;
    const classname = escapeXml(`grok-device.${r.platform}`);
    const name = escapeXml(`${r.action}${r.serial ? ` @ ${r.serial}` : ""}`);
    const attrs = `classname="${classname}" name="${name}" time="${timeSec.toFixed(3)}"`;

    if (reportPassed(r)) {
      const systemOut =
        r.healed && r.healMessage
          ? `\n      <system-out>${escapeXml(r.healMessage)}</system-out>`
          : "";
      return `    <testcase ${attrs}>${systemOut}\n    </testcase>`;
    }

    failures += 1;
    const msg = escapeXml(r.error ?? r.status);
    const detail = escapeXml(
      [
        r.errorCode ? `code=${r.errorCode}` : null,
        r.error,
        r.deviceName ? `device=${r.deviceName}` : null,
        r.serial ? `serial=${r.serial}` : null,
      ]
        .filter(Boolean)
        .join("\n"),
    );
    return `    <testcase ${attrs}>
      <failure message="${msg}" type="${escapeXml(r.errorCode ?? "ACTION_FAILED")}">${detail}</failure>
    </testcase>`;
  });

  const suiteName = escapeXml("grok-device");
  return `<?xml version="1.0" encoding="UTF-8"?>
<testsuites name="${suiteName}" tests="${tests}" failures="${failures}" time="${totalTimeSec.toFixed(3)}">
  <testsuite name="${suiteName}" tests="${tests}" failures="${failures}" time="${totalTimeSec.toFixed(3)}">
${cases.join("\n")}
  </testsuite>
</testsuites>
`;
}

export function formatJsonReport(reports: JobReport[]): string {
  return `${JSON.stringify(
    {
      product: "grok-device",
      generatedAt: new Date().toISOString(),
      summary: {
        total: reports.length,
        passed: reports.filter((r) => r.ok && !r.healed).length,
        healed: reports.filter((r) => r.healed).length,
        failed: reports.filter((r) => !r.ok).length,
      },
      reports,
    },
    null,
    2,
  )}\n`;
}

export function classifyJobError(message: string): string {
  const m = message.toLowerCase();
  if (
    /no devices?|device (not found|missing|offline)|not connected|unknown serial|no such device/.test(
      m,
    )
  ) {
    return "DEVICE_MISSING";
  }
  if (/account|switch.*play|play account|prod_account_match/.test(m)) {
    return "ACCOUNT_SWITCH_FAILED";
  }
  if (/timeout|timed out|deadline/.test(m)) {
    return "TIMEOUT";
  }
  return "ACTION_FAILED";
}

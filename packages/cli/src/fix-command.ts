/**
 * `relay fix <runId> [<step>]`: the Fix with Agent handoff. Reads one run's
 * verdict and writes a self-contained markdown prompt a coding agent (Claude
 * Code, Cursor, Codex) can act on: what was expected vs. what Relay saw, the
 * exact evidence references, the one command that re-runs the same saved Test,
 * and the scope discipline that keeps the fix minimal. Only fields the run
 * record actually carries appear; missing evidence omits its section.
 */
import { CliError, ExitCode } from "./errors.js";
import { duration } from "./everyday-format.js";
import { shellWord, type EverydayInvoke } from "./everyday-names.js";

export type FixVerdictStep = {
  id: string;
  title: string;
  kind?: "action" | "check";
  status: "passed" | "failed" | "not-run";
  expected?: string;
  saw?: string;
  screenshot?: string;
  replay?: { source: "cache" | "model" | "re-resolved"; detail?: string };
};

export type FixVerdict = {
  runId: string;
  title: string;
  status: "passed" | "failed" | "blocked" | "cancelled" | "running";
  summary: string;
  reason?: string;
  durationMs?: number;
  device?: string;
  steps: FixVerdictStep[];
};

/** The saved Test the run executed, when the run record carries its identity. */
export type FixTestIdentity = { appMapId: string; testId: string };

export type FixHandoffStep = {
  id: string;
  /** 1-based position in the Test, matching the verdict's step order. */
  index: number;
  title: string;
  kind?: "action" | "check";
  expected?: string;
  saw?: string;
  screenshot?: string;
  replay?: { source: "cache" | "model" | "re-resolved"; detail?: string };
};

/** The structured handoff: stable for --json, with the markdown in `prompt`. */
export type FixHandoff = {
  runId: string;
  status: "failed" | "blocked";
  title: string;
  summary: string;
  reason?: string;
  device?: string;
  durationMs?: number;
  test?: FixTestIdentity;
  step: FixHandoffStep;
  /** Total failed steps in the run; the handoff covers one. */
  failedSteps: number;
  reproduce?: string;
  prompt: string;
};

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/** One line of inline user text: whitespace flattened so the markdown rows
 * stay one line each; typographic quotes keep literal quotes inside intact. */
function inline(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}

function quoted(value: string): string {
  return `“${inline(value)}”`;
}

function stepRefError(runId: string, stepRef: string): CliError {
  return new CliError(
    `Run ${runId} has no step “${stepRef}”. Name a failed step by its position or id.`,
    ExitCode.validation,
  );
}

function selectStep(
  verdict: FixVerdict,
  stepRef: string | undefined,
): { step: FixVerdictStep; index: number } {
  const indexed = verdict.steps.map((step, position) => ({ step, index: position + 1 }));
  const failed = indexed.filter(({ step }) => step.status === "failed");
  if (!failed.length) {
    throw new CliError(
      `Run ${verdict.runId} ${verdict.status === "blocked" ? "was blocked" : "failed"}, but Relay recorded no failed step to hand off.`,
      ExitCode.validation,
    );
  }
  if (stepRef === undefined) return failed[0]!;
  const position = /^\d+$/u.test(stepRef) ? Number(stepRef) : undefined;
  const byId = position === undefined ? indexed.find(({ step }) => step.id === stepRef) : undefined;
  const selected = position === undefined ? byId : indexed[position - 1];
  if (!selected) throw stepRefError(verdict.runId, stepRef);
  if (selected.step.status !== "failed") {
    throw new CliError(
      `Step “${stepRef}” (${selected.step.title}) did not fail in this run — nothing to fix there.`,
      ExitCode.validation,
    );
  }
  return selected;
}

function assertFixable(verdict: FixVerdict): void {
  if (verdict.status === "passed") {
    throw new CliError(`Run ${verdict.runId} passed — nothing to fix.`, ExitCode.validation);
  }
  if (verdict.status === "cancelled") {
    throw new CliError(`Run ${verdict.runId} was cancelled — nothing to fix.`, ExitCode.validation);
  }
  if (verdict.status === "running") {
    throw new CliError(
      `Run ${verdict.runId} is still running — wait for its verdict, then hand off the failure.`,
      ExitCode.validation,
    );
  }
}

function leadLine(handoff: Omit<FixHandoff, "prompt">, totalSteps: number): string {
  const { step } = handoff;
  const outcome =
    handoff.status === "failed"
      ? `failed step ${step.index} of ${totalSteps}`
      : `was blocked at step ${step.index} of ${totalSteps}`;
  const contrast =
    step.expected !== undefined && step.saw !== undefined
      ? `: expected ${quoted(step.expected)}, but Relay saw ${quoted(step.saw)}`
      : step.expected !== undefined
        ? `: expected ${quoted(step.expected)}`
        : step.saw !== undefined
          ? `: Relay saw ${quoted(step.saw)}`
          : "";
  return `Run \`${handoff.runId}\` ${outcome}, ${quoted(step.title)}${contrast}.`;
}

function formatPrompt(handoff: Omit<FixHandoff, "prompt">, totalSteps: number): string {
  const { step } = handoff;
  const lines: string[] = [
    `# Fix the failing Relay test ${quoted(handoff.title)}`,
    "",
    leadLine(handoff, totalSteps),
  ];
  const context = [
    handoff.device ? `ran on ${inline(handoff.device)}` : undefined,
    handoff.durationMs !== undefined ? `took ${duration(handoff.durationMs)}` : undefined,
  ].filter(Boolean);
  if (context.length) lines.push(`It ${context.join(" and ")}.`);

  const evidence: string[] = [];
  if (step.screenshot) {
    evidence.push(
      `- Screenshot of the screen at the failure: \`${step.screenshot}\` — read this image before changing code.`,
    );
  }
  evidence.push(
    `- Pass run id \`${handoff.runId}\` to the \`relay_inspect_failure\` MCP tool, or run \`relay inspect-failure ${shellWord(handoff.runId)}\` in a terminal, for the full failure detail.`,
    `- \`relay export ${shellWord(handoff.runId)} --out ./relay-evidence\` writes the frozen evidence pack for offline analysis.`,
  );
  if (step.replay?.source === "re-resolved") {
    evidence.push(
      `- The step's saved path no longer matched, so Relay re-resolved the step live during this run.`,
    );
  }
  if (handoff.status === "blocked") {
    evidence.push(
      `- Relay was blocked, which is often a device, sign-in, or harness problem rather than app code — check the evidence before changing the app.`,
    );
  }
  if (handoff.failedSteps > 1) {
    evidence.push(
      `- ${handoff.failedSteps} steps failed in this run; this prompt covers step ${step.index} only.`,
    );
  }
  lines.push("", "## Evidence", "", ...evidence);

  const goal = step.expected ?? step.title;
  const lines2 = [
    "",
    "## Fix, then verify",
    "",
    `1. Make the smallest change in this repository that makes step ${step.index} pass: ${quoted(goal)}. Change the app, not the test — if the expectation itself is outdated, stop and say why instead of editing the test. Do not refactor beyond what the fix needs.`,
  ];
  if (handoff.reproduce && handoff.test) {
    lines2.push(
      `2. Verify by re-running the same saved test against your fix:`,
      "",
      "   ```",
      `   ${handoff.reproduce}`,
      "   ```",
      "",
      `   With Relay's MCP tools, \`relay_run_test\` with testId \`${handoff.test.testId}\` and appMapId \`${handoff.test.appMapId}\` runs the same test.`,
      `3. The fix works when every step passes. If the run still fails, \`relay fix <new-runId>\` hands off the new failure the same way. If Relay reports a risk and asks for confirmation before it may run, stop and ask first.`,
    );
  } else {
    lines2.push(
      `2. This run does not carry the saved Test's identity, so Relay cannot write the exact re-run command. Re-run the test the way this run was started.`,
      `3. The fix works when every step passes. If Relay reports a risk and asks for confirmation before it may run, stop and ask first.`,
    );
  }
  return [...lines, ...lines2].join("\n");
}

/** The pure handoff: verdict plus optional saved-Test identity in, structured
 * handoff with its markdown prompt out. Honest rejections for runs with
 * nothing to fix. */
export function buildFixHandoff(input: {
  verdict: FixVerdict;
  test?: FixTestIdentity;
  stepRef?: string;
}): FixHandoff {
  const { verdict } = input;
  assertFixable(verdict);
  const { step, index } = selectStep(verdict, input.stepRef);
  const failedSteps = verdict.steps.filter((item) => item.status === "failed").length;
  const handoff: Omit<FixHandoff, "prompt"> = {
    runId: verdict.runId,
    status: verdict.status as "failed" | "blocked",
    title: verdict.title,
    summary: verdict.summary,
    ...(verdict.reason ? { reason: verdict.reason } : {}),
    ...(verdict.device ? { device: verdict.device } : {}),
    ...(verdict.durationMs !== undefined ? { durationMs: verdict.durationMs } : {}),
    ...(input.test ? { test: input.test } : {}),
    step: {
      id: step.id,
      index,
      title: step.title,
      ...(step.kind ? { kind: step.kind } : {}),
      ...(step.expected !== undefined ? { expected: step.expected } : {}),
      ...(step.saw !== undefined ? { saw: step.saw } : {}),
      ...(step.screenshot !== undefined ? { screenshot: step.screenshot } : {}),
      ...(step.replay ? { replay: step.replay } : {}),
    },
    failedSteps,
    ...(input.test
      ? {
          reproduce: `relay run ${shellWord(input.test.testId)} --app ${shellWord(input.test.appMapId)}`,
        }
      : {}),
  };
  return { ...handoff, prompt: formatPrompt(handoff, verdict.steps.length) };
}

/** The saved-Test identity one `/runs/:id` read carries, when it does. Mirrors
 * the canonical `runTestSource` projection in core: the frozen execution
 * intent wins over the action string, because the intent is immutable
 * provenance while the action is a label. */
export function runTestIdentity(runResource: unknown): FixTestIdentity | undefined {
  const run = record(record(runResource)?.run) ?? record(runResource);
  if (!run) return undefined;
  for (const item of Array.isArray(run.artifacts) ? run.artifacts : []) {
    const artifact = record(item);
    const data = record(artifact?.data);
    const source =
      artifact?.kind === "app-map-test-execution-intent"
        ? record(data?.sourcePlan)
        : artifact?.kind === "app-map-combine-cell-execution-intent"
          ? record(record(data?.child)?.sourcePlan)
          : undefined;
    if (
      typeof source?.appMapId === "string" &&
      source.appMapId &&
      typeof source.testId === "string" &&
      source.testId
    ) {
      return { appMapId: source.appMapId, testId: source.testId };
    }
  }
  const match =
    typeof run.action === "string"
      ? /^app-map:([^:]+):test:([^:]+)(?::|$)/u.exec(run.action)
      : undefined;
  return match ? { appMapId: match[1]!, testId: match[2]! } : undefined;
}

export async function runFixCommand(input: {
  runId: string;
  stepRef?: string;
  invoke: EverydayInvoke;
}): Promise<FixHandoff> {
  const response = record(await input.invoke("run.verdict.get", { runId: input.runId }));
  const verdict = record(response?.verdict);
  if (!verdict || typeof verdict.status !== "string" || !Array.isArray(verdict.steps)) {
    throw new CliError(
      "Malformed run.verdict.get response: expected a verdict with steps",
      ExitCode.server,
    );
  }
  let test: FixTestIdentity | undefined;
  // Lineage only sharpens the re-run command of a handoff that exists; a
  // passed, cancelled, or still-running verdict is rejected without it.
  if (verdict.status === "failed" || verdict.status === "blocked") {
    try {
      test = runTestIdentity(await input.invoke("run.get", { runId: input.runId }));
    } catch {
      // The verdict is the handoff; lineage only sharpens the re-run command.
    }
  }
  return buildFixHandoff({
    verdict: verdict as unknown as FixVerdict,
    ...(test ? { test } : {}),
    ...(input.stepRef !== undefined ? { stepRef: input.stepRef } : {}),
  });
}

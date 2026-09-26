/**
 * Live terminal view for running Tests and Plans: one row per Test with its
 * current step, redrawn in place on a TTY and printed as plain changes
 * otherwise (CI logs, pipes). Rendering is pure so it can be tested.
 */
import type { Writable } from "node:stream";

export type LiveRowState = "queued" | "running" | "passed" | "review" | "failed" | "cancelled";

export type LiveRow = {
  id: string;
  title: string;
  state: LiveRowState;
  /** Current step or short outcome, e.g. `step 2/5 · Tap "Mic"`. */
  detail?: string;
  startedAt?: number;
  finishedAt?: number;
};

export type LiveHeader = { title: string; target?: string; startedAt: number };

const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const color = {
  dim: (value: string) => `\u001b[2m${value}\u001b[22m`,
  bold: (value: string) => `\u001b[1m${value}\u001b[22m`,
  green: (value: string) => `\u001b[32m${value}\u001b[39m`,
  red: (value: string) => `\u001b[31m${value}\u001b[39m`,
  yellow: (value: string) => `\u001b[33m${value}\u001b[39m`,
  cyan: (value: string) => `\u001b[36m${value}\u001b[39m`,
};
const plain = {
  dim: (value: string) => value,
  bold: (value: string) => value,
  green: (value: string) => value,
  red: (value: string) => value,
  yellow: (value: string) => value,
  cyan: (value: string) => value,
};

export function formatClock(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function mark(state: LiveRowState, frame: number, paint: typeof color): string {
  switch (state) {
    case "passed":
      return paint.green("✓");
    case "review":
      return paint.yellow("◐");
    case "failed":
      return paint.red("✗");
    case "cancelled":
      return paint.dim("–");
    case "running":
      return paint.cyan(SPINNER[frame % SPINNER.length]!);
    default:
      return paint.dim("·");
  }
}

function fit(value: string, width: number): string {
  if (width <= 1) return "";
  return value.length > width ? `${value.slice(0, width - 1)}…` : value;
}

export function summarizeRows(rows: readonly LiveRow[]): string {
  const count = (state: LiveRowState) => rows.filter((row) => row.state === state).length;
  const done = rows.filter((row) => row.state !== "queued" && row.state !== "running").length;
  return [
    `${done}/${rows.length} done`,
    count("passed") ? `${count("passed")} passed` : undefined,
    count("review") ? `${count("review")} to review` : undefined,
    count("failed") ? `${count("failed")} failed` : undefined,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** The whole frame as lines, `width` columns wide. */
export function renderLiveFrame(input: {
  header: LiveHeader;
  rows: readonly LiveRow[];
  now: number;
  frame: number;
  width: number;
  colors: boolean;
}): string[] {
  const paint = input.colors ? color : plain;
  const width = Math.max(40, Math.min(input.width, 120));
  const clock = formatClock(input.now - input.header.startedAt);
  const heading = [input.header.title, input.header.target].filter(Boolean).join(" · ");
  const left = ` Relay ▸ ${fit(heading, width - clock.length - 12)}`;
  const lines = [
    `${paint.bold(left)}${" ".repeat(Math.max(1, width - left.length - clock.length - 1))}${paint.dim(clock)}`,
  ];
  const titleWidth = Math.min(36, Math.max(12, ...input.rows.map((row) => row.title.length)));
  for (const row of input.rows) {
    const title = fit(row.title, titleWidth).padEnd(titleWidth);
    const took =
      row.startedAt !== undefined && (row.finishedAt || row.state === "running")
        ? formatClock((row.finishedAt ?? input.now) - row.startedAt)
        : "";
    const detailWidth = width - titleWidth - took.length - 8;
    const detail = fit(row.detail ?? (row.state === "queued" ? "queued" : ""), detailWidth);
    lines.push(
      `  ${mark(row.state, input.frame, paint)} ${row.state === "queued" ? paint.dim(title) : title}  ${paint.dim(detail.padEnd(Math.max(0, detailWidth)))} ${paint.dim(took)}`.trimEnd(),
    );
  }
  lines.push(paint.dim(`  ${summarizeRows(input.rows)}`));
  return lines;
}

/** Draws frames on a TTY (in place) or prints row changes on other streams. */
export class LiveRunView {
  private rows: LiveRow[] = [];
  private header: LiveHeader;
  private frame = 0;
  private drawn = 0;
  private timer: ReturnType<typeof setInterval> | undefined;
  private readonly printed = new Map<string, string>();
  private readonly titles = new Map<string, string>();
  private readonly tty: boolean;

  constructor(
    private readonly stream: Writable & { isTTY?: boolean; columns?: number },
    header: Omit<LiveHeader, "startedAt"> & { startedAt?: number },
    private readonly now: () => number = Date.now,
  ) {
    this.header = { ...header, startedAt: header.startedAt ?? now() };
    this.tty = Boolean(stream.isTTY) && process.env.TERM !== "dumb" && !process.env.CI;
  }

  update(rows: readonly LiveRow[], header?: Partial<LiveHeader>): void {
    // Later snapshots can carry a generic title ("Run <id>"); keep the name
    // the row was first shown with.
    this.rows = rows.map((row) => {
      const known = this.titles.get(row.id);
      if (known && /^Run /u.test(row.title)) return { ...row, title: known };
      if (!known || /^Run /u.test(known)) this.titles.set(row.id, row.title);
      return row;
    });
    if (header) this.header = { ...this.header, ...header };
    if (this.tty) {
      this.timer ??= setInterval(() => this.draw(), 80);
      this.timer.unref?.();
      this.draw();
      return;
    }
    for (const row of this.rows) {
      const text = `${row.state}${row.detail ? ` · ${row.detail}` : ""}`;
      if (this.printed.get(row.id) === text) continue;
      this.printed.set(row.id, text);
      this.stream.write(`${row.title}: ${text}\n`);
    }
  }

  /** Final frame; leaves the cursor below it. */
  finish(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    if (this.tty) this.draw(true);
  }

  private draw(final = false): void {
    this.frame += 1;
    const lines = renderLiveFrame({
      header: this.header,
      rows: this.rows,
      now: this.now(),
      frame: this.frame,
      width: this.stream.columns ?? 100,
      colors: true,
    });
    let output = this.drawn ? `\u001b[${this.drawn}F` : "\u001b[?25l";
    output += lines.map((line) => `\u001b[2K${line}`).join("\n");
    output += final ? "\n\u001b[?25h" : "\n";
    this.stream.write(output);
    this.drawn = final ? 0 : lines.length;
  }
}

type JobLike = {
  id?: unknown;
  title?: unknown;
  status?: unknown;
  outcome?: unknown;
  startedAt?: unknown;
  finishedAt?: unknown;
  deviceName?: unknown;
  steps?: unknown;
  captureSummary?: unknown;
};

function lastOf<T>(items: readonly T[], match: (item: T) => boolean): T | undefined {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    if (match(items[index]!)) return items[index];
  }
  return undefined;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function number(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** One live row from a `job.get` job record. */
export function liveRowFromJob(value: unknown, fallbackTitle = "Test"): LiveRow | undefined {
  if (!value || typeof value !== "object") return undefined;
  const job = value as JobLike;
  const id = text(job.id);
  if (!id) return undefined;
  const status = text(job.status) ?? "queued";
  const steps = Array.isArray(job.steps)
    ? (job.steps as { title?: unknown; status?: unknown }[])
    : [];
  const summary = (job.captureSummary ?? {}) as { pending?: number; issue?: number };
  const state: LiveRowState =
    status === "queued" || status === "pending"
      ? "queued"
      : status === "running" || status === "paused"
        ? "running"
        : status === "cancelled"
          ? "cancelled"
          : status === "ok" || status === "passed" || status === "completed"
            ? (summary.pending ?? 0) > 0
              ? "review"
              : "passed"
            : "failed";
  const running = lastOf(steps, (step) => text(step.status) === "running") ?? steps.at(-1);
  const detail =
    state === "running"
      ? steps.length
        ? `step ${steps.length} · ${text(running?.title) ?? "working"}`
        : status === "paused"
          ? "waiting for a person"
          : "starting"
      : state === "review"
        ? `${summary.pending} screenshot${summary.pending === 1 ? "" : "s"} to review`
        : state === "passed"
          ? `${steps.length} step${steps.length === 1 ? "" : "s"}`
          : state === "failed"
            ? (text(lastOf(steps, (step) => /fail|error/u.test(String(step.status)))?.title) ??
              "failed")
            : undefined;
  return {
    id,
    title: text(job.title) ?? fallbackTitle,
    state,
    ...(detail ? { detail } : {}),
    ...(number(job.startedAt) ? { startedAt: number(job.startedAt)! } : {}),
    ...(number(job.finishedAt) ? { finishedAt: number(job.finishedAt)! } : {}),
  };
}

/** One live row from a `relay run` workflow snapshot. */
export function liveRowFromWorkflow(value: unknown): LiveRow | undefined {
  if (!value || typeof value !== "object") return undefined;
  const snapshot = value as {
    title?: unknown;
    phase?: unknown;
    progress?: { label?: unknown; completed?: unknown; total?: unknown };
    review?: { pending?: unknown; decided?: unknown };
    workflow?: { workflowId?: unknown };
    compiled?: { plan?: { test?: { name?: unknown } } };
  };
  const phase = text(snapshot.phase) ?? "queued";
  const pending = number(snapshot.review?.pending) ?? 0;
  const state: LiveRowState =
    phase === "queued"
      ? "queued"
      : phase === "running" || phase === "paused"
        ? "running"
        : phase === "cancelled"
          ? "cancelled"
          : phase === "succeeded"
            ? pending > 0
              ? "review"
              : "passed"
            : "failed";
  const completed = number(snapshot.progress?.completed);
  const total = number(snapshot.progress?.total);
  const label = text(snapshot.progress?.label);
  const decided = number(snapshot.review?.decided) ?? 0;
  const detail =
    state === "review"
      ? `${pending} screenshot${pending === 1 ? "" : "s"} to review`
      : state === "passed" && decided
        ? decided === 1
          ? "screenshot matches its reference"
          : `${decided} screenshots match their references`
        : [completed !== undefined && total ? `step ${completed}/${total}` : undefined, label]
            .filter(Boolean)
            .join(" · ");
  return {
    id: text(snapshot.workflow?.workflowId) ?? "run",
    title: text(snapshot.compiled?.plan?.test?.name) ?? text(snapshot.title) ?? "Test",
    state,
    ...(detail ? { detail } : {}),
  };
}

/**
 * Poll every started job together so each row stays live, not just the first.
 * Returns the terminal `job.get` results in the order the jobs were started.
 */
export async function watchJobsLive(input: {
  jobIds: readonly string[];
  fetch(jobId: string): Promise<unknown>;
  isTerminal(result: unknown): boolean;
  wait(ms: number): Promise<void>;
  view: LiveRunView;
  pollIntervalMs: number;
  titleFor?(index: number): string;
}): Promise<unknown[]> {
  const latest = new Map<string, unknown>();
  while (true) {
    const open = input.jobIds.filter((id) => {
      const current = latest.get(id);
      return current === undefined || !input.isTerminal(current);
    });
    const fetched = await Promise.all(open.map((id) => input.fetch(id)));
    open.forEach((id, index) => latest.set(id, fetched[index]));
    input.view.update(
      input.jobIds.map(
        (id, index) =>
          liveRowFromJob(
            (latest.get(id) as { job?: unknown } | undefined)?.job,
            input.titleFor?.(index) ?? `Test ${index + 1}`,
          ) ?? { id, title: input.titleFor?.(index) ?? `Test ${index + 1}`, state: "queued" },
      ),
    );
    if (input.jobIds.every((id) => input.isTerminal(latest.get(id)))) {
      input.view.finish();
      return input.jobIds.map((id) => latest.get(id));
    }
    await input.wait(Math.max(input.pollIntervalMs, 500));
  }
}

/** A readable heading for a started operation: the Plan or Test it runs. */
export function liveTitleFromInput(input: unknown, fallback: string): string {
  const record = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const name = [record.combineId, record.testId, record.flowId].find(
    (value): value is string => typeof value === "string" && value.length > 0,
  );
  const app = typeof record.appMapId === "string" ? record.appMapId : undefined;
  return name ? [name, app].filter(Boolean).join(" · ") : fallback;
}

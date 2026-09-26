/**
 * Portable review checklist for a Combine pack.
 *
 * Status comes from typed findings (PRODUCT_ASSERTION, HARNESS_FAILURE,
 * cancelled), never from scraping error prose. Confirm/Reject stay off this
 * page; the only accept path linked here is `relay run visual review`.
 */
import { readFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import type { CombineEvidenceFinding, CombineEvidenceFindingCode } from "@relay/protocol";

export const REVIEW_CHECKLIST_STATUSES = [
  "passed",
  "pending review",
  "check failed",
  "could not run",
  "cancelled",
  "todo",
] as const;

export type ReviewChecklistStatus = (typeof REVIEW_CHECKLIST_STATUSES)[number];

export type ReviewChecklistTodoItem = {
  id: string;
  title: string;
  note?: string;
  jobId?: string;
};

export type ReviewChecklistRow = {
  id: string;
  test: string;
  status: ReviewChecklistStatus;
  jobId?: string;
  beforePng?: string;
  afterPng?: string;
  visualComparisonId?: string;
  reviewCommand?: string;
  findingCode?: CombineEvidenceFindingCode;
  note?: string;
};

/** The stored status stays stable. The page says what a reviewer should do. */
export function reviewChecklistStatusLabel(status: ReviewChecklistStatus): string {
  return status === "pending review" ? "awaiting review" : status;
}

export type ReviewChecklistCase = {
  jobId: string;
  name: string;
  status: string;
  frames: readonly string[];
  note?: string;
  /** Dest-phase identity raster. Leftover Close last-frame cannot fill dest. */
  destIdentityFrame?: string;
};

const JOB_FINDING_CODES: readonly CombineEvidenceFindingCode[] = [
  "PRODUCT_ASSERTION",
  "JUDGE_UNCERTAIN",
  "HARNESS_FAILURE",
  "USER_CANCELLED",
  "BLOCKED",
  "ACCOUNT_NEEDS_RELOGIN",
];

export const REVIEW_CHECKLIST_START = "<!-- relay-review-checklist -->";
export const REVIEW_CHECKLIST_END = "<!-- /relay-review-checklist -->";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function encodePath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}

function todoIdFromTitle(title: string): string {
  const slug = title
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return slug || "todo";
}

/** Exact CLI a person uses to accept or reject a visual candidate. */
export function visualReviewCommand(jobId: string): string {
  return `relay run visual review ${jobId}`;
}

/** Match dest identity `frames/003.png` onto pack `002-003.png` / `003.png`. */
export function reviewChecklistDestIdentityFrame(
  frames: readonly string[],
  destIdentityFrame?: string,
): string | undefined {
  const identity = destIdentityFrame?.trim();
  if (!identity) return undefined;
  const name = basename(identity);
  return frames.find((path) => {
    const pack = basename(path);
    return pack === name || pack.endsWith(`-${name}`);
  });
}

function packOriginalName(path: string): string {
  const pack = basename(path);
  const dash = pack.lastIndexOf("-");
  return dash >= 0 ? pack.slice(dash + 1) : pack;
}

/** Numbered leftover Close last-frame after dest identity, e.g. dest 003 vs 003-004.png. */
export function reviewChecklistIsLeftoverLastFrame(
  path: string,
  destIdentityFrame?: string,
): boolean {
  const identity = destIdentityFrame?.trim();
  if (!identity) return false;
  const destStem = basename(identity).replace(/\.png$/iu, "");
  const originalStem = packOriginalName(path).replace(/\.png$/iu, "");
  return originalStem > destStem;
}

export function reviewChecklistFramePair(
  frames: readonly string[],
  destIdentityFrame?: string,
): {
  beforePng?: string;
  afterPng?: string;
} {
  const shots = frames.filter((path) => !/(?:^|\/)full\.png$/u.test(path));
  if (!shots.length) return {};
  const dest = reviewChecklistDestIdentityFrame(shots, destIdentityFrame);
  const usable = destIdentityFrame
    ? shots.filter((path) => !reviewChecklistIsLeftoverLastFrame(path, destIdentityFrame))
    : shots;
  return {
    beforePng: usable[0] ?? shots[0],
    afterPng: dest ?? usable.at(-1),
  };
}

/**
 * Classify one Test row from status + a canonical job finding code.
 * Locale codes such as POSSIBLE_UNTRANSLATED_TEXT are not inputs here.
 */
export function classifyReviewChecklistStatus(input: {
  status: string;
  findingCode?: CombineEvidenceFindingCode;
  captureReviewPending?: boolean;
}): ReviewChecklistStatus {
  if (input.findingCode === "PRODUCT_ASSERTION") return "check failed";
  if (input.findingCode === "JUDGE_UNCERTAIN") return "pending review";
  if (input.findingCode === "USER_CANCELLED") return "cancelled";
  if (
    input.findingCode === "HARNESS_FAILURE" ||
    input.findingCode === "BLOCKED" ||
    input.findingCode === "ACCOUNT_NEEDS_RELOGIN"
  ) {
    return "could not run";
  }
  if (input.status === "cancelled") return "cancelled";
  if (input.status === "ok" || input.status === "healed" || input.status === "passed") {
    return input.captureReviewPending ? "pending review" : "passed";
  }
  return "could not run";
}

export function jobFindingCodeForChecklist(
  findings: readonly CombineEvidenceFinding[],
  jobId: string,
): CombineEvidenceFindingCode | undefined {
  const codes = findings
    .filter((finding) => finding.canonicalKey === `job:${jobId}`)
    .map((finding) => finding.code);
  return JOB_FINDING_CODES.find((code) => codes.includes(code));
}

export function reviewChecklistRows(input: {
  cases: readonly ReviewChecklistCase[];
  findings: readonly CombineEvidenceFinding[];
  visualComparisonByJobId?: ReadonlyMap<string, string> | Readonly<Record<string, string>>;
  todoItems?: readonly ReviewChecklistTodoItem[];
  pendingReviewJobIds?: ReadonlySet<string>;
}): ReviewChecklistRow[] {
  const comparisonOf = (jobId: string): string | undefined => {
    const table = input.visualComparisonByJobId;
    if (!table) return undefined;
    if (table instanceof Map) return table.get(jobId);
    return (table as Readonly<Record<string, string>>)[jobId];
  };
  const rows = input.cases.map((item) => {
    const findingCode = jobFindingCodeForChecklist(input.findings, item.jobId);
    const frames = reviewChecklistFramePair(item.frames, item.destIdentityFrame);
    const comparisonId = comparisonOf(item.jobId);
    return {
      id: item.jobId,
      test: item.name,
      status: classifyReviewChecklistStatus({
        status: item.status,
        findingCode,
        ...(input.pendingReviewJobIds?.has(item.jobId) ? { captureReviewPending: true } : {}),
      }),
      jobId: item.jobId,
      reviewCommand: visualReviewCommand(item.jobId),
      ...(findingCode ? { findingCode } : {}),
      ...(frames.beforePng ? { beforePng: frames.beforePng } : {}),
      ...(frames.afterPng ? { afterPng: frames.afterPng } : {}),
      ...(comparisonId ? { visualComparisonId: comparisonId } : {}),
      ...(item.note ? { note: item.note } : {}),
    } satisfies ReviewChecklistRow;
  });
  return mergeReviewChecklistTodos(rows, input.todoItems ?? []);
}

export function mergeReviewChecklistTodos(
  rows: readonly ReviewChecklistRow[],
  todos: readonly ReviewChecklistTodoItem[],
): ReviewChecklistRow[] {
  const bound = new Set(
    rows.flatMap((row) => [row.id, row.jobId].filter((value): value is string => Boolean(value))),
  );
  const extra: ReviewChecklistRow[] = [];
  for (const item of todos) {
    if (bound.has(item.id) || (item.jobId && bound.has(item.jobId))) continue;
    bound.add(item.id);
    extra.push({
      id: item.id,
      test: item.title,
      status: "todo",
      ...(item.jobId ? { jobId: item.jobId } : {}),
      ...(item.note ? { note: item.note } : {}),
    });
  }
  return [...rows, ...extra];
}

function parseTodoItem(value: unknown): ReviewChecklistTodoItem {
  if (typeof value === "string") {
    const title = value.trim();
    if (!title) throw new Error("todo item title is required");
    return { id: todoIdFromTitle(title), title };
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("todo item must be a string or { id, title }");
  }
  const record = value as Record<string, unknown>;
  const title = typeof record.title === "string" ? record.title.trim() : "";
  if (!title) throw new Error("todo item title is required");
  const id =
    typeof record.id === "string" && record.id.trim() ? record.id.trim() : todoIdFromTitle(title);
  const note =
    typeof record.note === "string" && record.note.trim() ? record.note.trim() : undefined;
  const jobId =
    typeof record.jobId === "string" && record.jobId.trim() ? record.jobId.trim() : undefined;
  return { id, title, ...(note ? { note } : {}), ...(jobId ? { jobId } : {}) };
}

function parseJsonTodos(value: unknown): ReviewChecklistTodoItem[] {
  const nested =
    value && typeof value === "object" && Array.isArray((value as { items?: unknown }).items)
      ? (value as { items: unknown[] }).items
      : undefined;
  const items = Array.isArray(value) ? value : nested;
  if (!items) throw new Error("todo file must be a JSON array or { items: [...] }");
  return items.map(parseTodoItem);
}

function parseMarkdownTodos(raw: string): ReviewChecklistTodoItem[] {
  const items: ReviewChecklistTodoItem[] = [];
  for (const line of raw.split(/\r?\n/u)) {
    const match = /^-\s+\[\s\]\s+(.+)$/u.exec(line.trim());
    if (!match) continue;
    items.push(parseTodoItem(match[1]));
  }
  return items;
}

/** JSON array / `{ items }` first; otherwise unchecked Markdown `- [ ]` lines. */
export function parseReviewChecklistTodoFile(raw: string): ReviewChecklistTodoItem[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    return parseJsonTodos(JSON.parse(trimmed) as unknown);
  }
  return parseMarkdownTodos(raw);
}

function pngCell(path: string | undefined, label: string): string {
  if (!path) return "—";
  const href = encodePath(path);
  return `<a href="${href}"><img src="${href}" alt="${escapeHtml(label)}"></a>`;
}

export function reviewChecklistSection(
  rows: readonly ReviewChecklistRow[],
  options?: { captureReview?: string },
): string {
  const body = rows
    .map((row) => {
      const note = row.note ? `<br><small>${escapeHtml(row.note)}</small>` : "";
      const comparison = row.visualComparisonId
        ? `<code>${escapeHtml(row.visualComparisonId)}</code>`
        : "—";
      const review = row.reviewCommand ? `<code>${escapeHtml(row.reviewCommand)}</code>` : "—";
      return `<tr data-status="${escapeHtml(row.status)}"><td><b>${escapeHtml(row.test)}</b>${note}</td><td class="status">${escapeHtml(reviewChecklistStatusLabel(row.status))}</td><td>${pngCell(row.beforePng, `${row.test} before`)}</td><td>${pngCell(row.afterPng, `${row.test} after`)}</td><td>${comparison}</td><td>${review}</td></tr>`;
    })
    .join("");
  return `<section id="review-checklist">
<style>
#review-checklist{margin:0 0 28px}#review-checklist h2{font-size:16px;margin:0 0 8px}#review-checklist .guidance{color:#64646c;margin:0 0 12px;font-size:13px}#review-checklist table{border-collapse:collapse;width:100%;background:#fff;border:1px solid #dedee3;border-radius:14px;overflow:hidden}#review-checklist th,#review-checklist td{border-bottom:1px solid #e8e8eb;padding:8px 10px;vertical-align:top;text-align:left;font-size:12px}#review-checklist th{color:#71717a;font-weight:600}#review-checklist img{max-width:160px;height:auto;border-radius:8px;background:#eee}#review-checklist code{font-size:11px;background:#f1f1f4;border-radius:5px;padding:1px 5px}#review-checklist tr[data-status="check failed"] .status,#review-checklist tr[data-status="could not run"] .status{color:#c2410c}#review-checklist tr[data-status=todo] .status,#review-checklist tr[data-status="pending review"] .status{color:#b45309}#review-checklist tr[data-status=passed] .status{color:#15803d}@media(prefers-color-scheme:dark){#review-checklist table{background:#222225;border-color:#39393f}#review-checklist th,#review-checklist td{border-color:#39393f}#review-checklist .guidance{color:#a1a1aa}#review-checklist code{background:#2e2e33}#review-checklist img{background:#111}#review-checklist tr[data-status="check failed"] .status,#review-checklist tr[data-status="could not run"] .status{color:#fdba74}#review-checklist tr[data-status=todo] .status,#review-checklist tr[data-status="pending review"] .status{color:#fbbf24}#review-checklist tr[data-status=passed] .status{color:#86efac}}
</style>
<h2>Review checklist</h2>
<p class="guidance">${
    options?.captureReview
      ? `${escapeHtml(options.captureReview)}. Looks correct makes that screenshot the reference for later runs.`
      : "Confirm and Reject never accept a visual baseline. Approve or reject pixels only with <code>relay run visual review &lt;job&gt;</code>."
  }</p>
<table><thead><tr><th>Test</th><th>Status</th><th>Before</th><th>After</th><th>visual-comparison</th><th>Review</th></tr></thead><tbody>${body}</tbody></table>
</section>`;
}

export function embedReviewChecklist(
  html: string,
  rows: readonly ReviewChecklistRow[],
  options?: { captureReview?: string },
): string {
  const block = `${REVIEW_CHECKLIST_START}\n${reviewChecklistSection(rows, options)}\n${REVIEW_CHECKLIST_END}`;
  const start = html.indexOf(REVIEW_CHECKLIST_START);
  if (start >= 0) {
    const end = html.indexOf(REVIEW_CHECKLIST_END);
    if (end < 0) throw new Error("review checklist HTML is missing its end marker");
    return `${html.slice(0, start)}${block}${html.slice(end + REVIEW_CHECKLIST_END.length)}`;
  }
  return html.replace("<main>", `<main>${block}`);
}

export async function writeReviewChecklistFiles(
  rootDir: string,
  html: string,
  rows: readonly ReviewChecklistRow[],
  options?: { captureReview?: string },
): Promise<string> {
  const next = embedReviewChecklist(html, rows, options);
  await writeFile(join(rootDir, "checklist.json"), `${JSON.stringify(rows, null, 2)}\n`, "utf8");
  return next;
}

export async function applyReviewChecklistTodosToPack(
  rootDir: string,
  todos: readonly ReviewChecklistTodoItem[],
): Promise<ReviewChecklistRow[]> {
  const checklistPath = join(rootDir, "checklist.json");
  const htmlPath = join(rootDir, "index.html");
  const existing = JSON.parse(await readFile(checklistPath, "utf8")) as ReviewChecklistRow[];
  if (!Array.isArray(existing)) throw new Error("pack checklist.json is not a row array");
  const rows = mergeReviewChecklistTodos(existing, todos);
  const html = await readFile(htmlPath, "utf8");
  await writeFile(htmlPath, embedReviewChecklist(html, rows), "utf8");
  await writeFile(checklistPath, `${JSON.stringify(rows, null, 2)}\n`, "utf8");
  return rows;
}

/** Latest persisted comparison id per run, from `.visual-comparisons.json`. */
export async function readVisualComparisonIdsByRunId(
  storeRoot: string,
): Promise<Map<string, string>> {
  let raw: unknown;
  try {
    raw = JSON.parse(
      await readFile(join(storeRoot, ".visual-comparisons.json"), "utf8"),
    ) as unknown;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return new Map();
    throw error;
  }
  if (!Array.isArray(raw)) return new Map();
  const latest = new Map<string, { id: string; comparedAt: number }>();
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    if (typeof record.id !== "string" || !record.id.trim()) continue;
    const snapshot = record.latest;
    const runId =
      snapshot &&
      typeof snapshot === "object" &&
      "runId" in snapshot &&
      typeof snapshot.runId === "string"
        ? snapshot.runId.trim()
        : "";
    if (!runId) continue;
    const comparedAt = typeof record.comparedAt === "number" ? record.comparedAt : 0;
    const previous = latest.get(runId);
    if (!previous || comparedAt >= previous.comparedAt) {
      latest.set(runId, { id: record.id.trim(), comparedAt });
    }
  }
  return new Map([...latest].map(([runId, value]) => [runId, value.id]));
}

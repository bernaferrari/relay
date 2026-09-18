import { compareCapturedContent } from "./combine-evidence-content.js";
import { comparisonHtml } from "./combine-evidence-comparison.js";
/**
 * Exporting a Combine batch as a pack a person can open.
 *
 * The pack is the deliverable of a Combine: one folder per case, the
 * authored screenshots in order, the findings computed from those same frames
 * and the trees captured beside them, and a portable HTML page that shows both
 * together.
 */
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import type {
  CombineEvidenceFinding,
  CombineEvidenceAnalysisReport,
  CombineEvidencePackManifest,
  CaptureReviewDecision,
} from "@relay/protocol";
import {
  formatCaptureReviewCoverageSummary,
  captureReviewIdentityFramePaths,
  captureReviewLeftoverLastFramePaths,
  destIdentityCheckpointFramePaths,
  isCaptureReviewLeftoverCaption,
} from "@relay/protocol";
import type { SnapshotNode } from "./device.js";
import { pngDimensions } from "./ios-geometry.js";
import { frameObservations } from "./frame-observation.js";
import { parseFrameTreeNodes, readFrameTreeNodes } from "./run-frame-tree.js";
import {
  analyzeCombineEvidenceBatchData,
  combineEvidenceCanonicalKey,
  type CombineEvidenceCapture,
} from "./combine-evidence-batch-analysis.js";
import { jobOutcomeFindings, mergeJobOutcomeFindings } from "./combine-evidence-job-findings.js";
import { readAccountReloginFindings } from "./plan-account-relogin-campaign.js";
import {
  readVisualComparisonIdsByRunId,
  reviewChecklistRows,
  writeReviewChecklistFiles,
  type ReviewChecklistTodoItem,
} from "./combine-evidence-review-checklist.js";
import { listPersistedRuns, runsRoot } from "./runs.js";
import { slugEvidencePathSegment } from "./screen-identity.js";
import { listJobs, type TestJob } from "./session.js";
import { captureReviewQueueForPlan } from "./capture-review-plan.js";
import {
  coverageOutcomesFromArtifacts,
  describeCoverageStepReasons,
} from "./coverage-step-outcome.js";
import { composeScrollSurveyFrames } from "./scrollable-survey.js";
import type { ScrollSurveyFrame } from "./scrollable-survey-types.js";
import { findWorkspaceRoot } from "./workspace-root.js";

export type { CombineEvidencePackManifest };

/**
 * A Combine case as the pack reads it.
 *
 * The live registry hands back a `TestJob`; the run store hands back the
 * `PersistedRun` written from one. They agree on everything a Combine is
 * evidence for — the frames, the artifacts, the case index — and differ only in
 * fields describing how the job was dispatched, which no finding depends on.
 * Naming the overlap lets one analyzer read a batch whether it is still in
 * memory or only on disk, without a cast that claims more than either type has.
 */
export type CombineEvidenceCase = Pick<
  TestJob,
  | "id"
  | "projectId"
  | "ownerId"
  | "action"
  | "batchId"
  | "caseIndex"
  | "artifacts"
  | "frames"
  | "steps"
  | "resolvedInputs"
  | "recipeId"
  | "recipeSnapshot"
  | "recipeGraph"
  | "runDir"
  | "error"
  | "outcome"
  | "failureCategory"
> & {
  /** Widened from `JobStatus`: the run store reads its own files back as text,
   * and the pack only ever reports this status, never branches on it. */
  status: string;
  /** Optional on a persisted run; every reader here already falls back. */
  captureReviews?: CaptureReviewDecision[];
  title?: string;
};

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

function findingLine(
  manifest: CombineEvidencePackManifest,
  finding: CombineEvidenceFinding,
): string {
  const frame = manifest.byCanonicalKey[finding.canonicalKey]?.[finding.locale];
  const detail = escapeHtml(finding.detail);
  const body = frame ? `<a href="${encodePath(frame)}">${detail}</a>` : detail;
  return `<li data-severity="${escapeHtml(finding.severity)}"><code>${escapeHtml(finding.code)}</code> ${body} <em>${escapeHtml(finding.confidence)} confidence</em></li>`;
}

function captureReviewQueueForCases(jobs: CombineEvidenceCase[]) {
  return captureReviewQueueForPlan(
    jobs.map((job) => ({
      id: job.id,
      artifacts: job.artifacts,
      captureReviews: job.captureReviews,
      outcome: job.outcome,
      status: job.status,
      recipeSnapshot: job.recipeSnapshot,
      recipeGraph: job.recipeGraph,
    })),
  );
}

function portablePackHtml(
  manifest: CombineEvidencePackManifest,
  captureReviewHeadline?: string,
): string {
  const passed = manifest.cases.filter((item) => item.status === "ok" || item.status === "healed");
  const expected = manifest.cases.reduce((total, item) => total + (item.expectedFrames ?? 0), 0);
  const captured = manifest.cases.reduce((total, item) => total + item.frames.length, 0);
  const { analysis, analysisCoverage } = manifest;
  const byLocale = new Map<string, CombineEvidenceFinding[]>();
  for (const finding of analysis.findings) {
    byLocale.set(finding.locale, [...(byLocale.get(finding.locale) ?? []), finding]);
  }
  const blind = analysisCoverage.frames - analysisCoverage.inspectedFrames;
  const cards = manifest.cases
    .map((item) => {
      const findings = byLocale.get(item.locale) ?? [];
      return `<section class="case">
  <header><div><strong>${escapeHtml(item.locale)}</strong><span>${escapeHtml(item.name)}</span></div><b data-status="${escapeHtml(item.status)}">${escapeHtml(item.status)}</b></header>
  <div class="frames">${
    item.frames.length
      ? item.frames
          .map(
            (frame, index) =>
              `<figure><img loading="lazy" src="${encodePath(frame)}" alt="${escapeHtml(item.locale)} screenshot ${index + 1}"><figcaption>${index + 1}</figcaption></figure>`,
          )
          .join("")
      : '<p class="empty">No screenshots captured</p>'
  }</div>
  ${
    findings.length
      ? `<ul class="findings">${findings.map((finding) => findingLine(manifest, finding)).join("")}</ul>`
      : `<p class="clean">No findings against ${escapeHtml(analysis.baselineLocale)}</p>`
  }
</section>`;
    })
    .join("\n");
  const summary = captureReviewHeadline
    ? `${escapeHtml(captureReviewHeadline)} · Looks correct does not approve a visual baseline.`
    : `${passed.length} of ${manifest.cases.length} runs passed · ${captured}${expected ? ` of ${expected}` : ""} screenshots · ${analysis.findings.length} finding${analysis.findings.length === 1 ? "" : "s"} (${analysis.critical} critical) against ${escapeHtml(analysis.baselineLocale)}${blind ? ` · ${blind} frame${blind === 1 ? "" : "s"} without a UI tree, checked for presence only` : ""}`;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(manifest.title)}</title>
<style>:root{color-scheme:light dark;font:14px ui-sans-serif,system-ui,sans-serif;background:#f7f7f8;color:#18181b}*{box-sizing:border-box}body{margin:0}main{max-width:1440px;margin:auto;padding:32px}h1{font-size:24px;letter-spacing:-.03em;margin:0 0 6px}.summary{color:#64646c;margin:0 0 28px}.case{background:#fff;border:1px solid #dedee3;border-radius:14px;margin:0 0 16px;overflow:hidden}.case>header{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:12px 14px;border-bottom:1px solid #e8e8eb}.case header div{display:grid;gap:2px}.case header span{font-size:12px;color:#71717a}.case header b{font-size:11px;text-transform:capitalize}.case header b[data-status=error],.case header b[data-status=cancelled]{color:#c2410c}.frames{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:10px;padding:10px}.frames figure{position:relative;margin:0;border-radius:9px;overflow:hidden;background:#eee;min-height:120px}.frames img{display:block;width:100%;height:240px;object-fit:contain}.frames figcaption{position:absolute;right:6px;bottom:6px;border-radius:99px;background:#000b;color:white;padding:3px 7px;font-size:10px}.empty{color:#71717a;padding:20px}.findings{margin:0;padding:4px 14px 14px 30px;display:grid;gap:6px}.findings li{font-size:12px}.findings li[data-severity=critical]{color:#b91c1c}.findings code{font-size:11px;background:#f1f1f4;border-radius:5px;padding:1px 5px}.findings em{color:#71717a;font-style:normal}.clean{margin:0;padding:4px 14px 14px;font-size:12px;color:#71717a}@media(prefers-color-scheme:dark){:root{background:#171719;color:#f4f4f5}.case{background:#222225;border-color:#39393f}.case>header{border-color:#39393f}.case header span,.summary,.empty,.clean{color:#a1a1aa}.frames figure{background:#111}.findings code{background:#2e2e33}.findings li[data-severity=critical]{color:#fca5a5}}</style></head>
<body><main><h1>${escapeHtml(manifest.title)}</h1><p class="summary">${summary} · ${new Date(manifest.generatedAt).toISOString()}</p>${cards}</main></body></html>\n`;
}

function expectedEvidenceFrames(job: CombineEvidenceCase): number | undefined {
  for (const artifact of job.artifacts ?? []) {
    if (
      artifact.kind !== "frozen-inputs" ||
      !artifact.data ||
      typeof artifact.data !== "object" ||
      !("expectedScreenshots" in artifact.data)
    )
      continue;
    const expected = artifact.data.expectedScreenshots;
    if (typeof expected === "number" && Number.isInteger(expected) && expected >= 0) {
      return expected;
    }
  }
  return undefined;
}

/**
 * A frame the harness captured around setup, rather than one the test asked for.
 *
 * Two kinds, and both are named by the code that takes them. A tap records a
 * `before · `/`after · ` pair. The matrix wrapper takes its own pair around the
 * body, so a reviewer can see the language change land, captioned
 * `locale:<locale> before body` / `after body` — or `world …` for an option run.
 *
 * Neither is the screen under test. The wrapper's "before body" is whatever
 * surface the language switch finished on, which for an iOS sweep is Apple's
 * Settings; comparing it across locales reports the harness and the endonyms in
 * the language list, not the product. "After body" is the authored screen again,
 * so analysing it reports every real finding twice.
 */
function isHarnessFrame(caption: string | undefined): boolean {
  const value = (caption ?? "").trim();
  return /^(?:before|after) · /.test(value) || /(?:^|\s)(?:before|after) body$/.test(value);
}

/**
 * Matrix packs contain the screenshots authored by the test, not the automatic
 * diagnostics captured around setup actions. The diagnostics stay in the full run
 * report. Failing closed keeps a nominal 7 × 10 pack from silently shipping with
 * fewer than 70 useful screenshots.
 */
export function evidenceFrameNames(job: CombineEvidenceCase): {
  names?: Set<string>;
  expected?: number;
} {
  const expected = expectedEvidenceFrames(job);
  if (expected === undefined) return {};
  const names = new Set(
    job.steps
      .flatMap((step) => step.frames)
      .filter((frame) => !isHarnessFrame(frame.caption))
      .map((frame) => basename(frame.path)),
  );
  if (names.size !== expected) {
    throw new Error(
      `run ${job.id} produced ${names.size} authored screenshot(s); expected ${expected}`,
    );
  }
  return { names, expected };
}

function combineEvidenceRoot(): string {
  return join(
    process.env.RELAY_WORKSPACE_ROOT?.trim() || findWorkspaceRoot(),
    ".relay",
    "combine-evidence",
  );
}

export function evidenceCaseLocale(job: CombineEvidenceCase): string {
  const fromInputs = (job.resolvedInputs?.locale ?? job.resolvedInputs?.language)?.trim();
  if (fromInputs) return fromInputs;
  for (const artifact of job.artifacts ?? []) {
    if (artifact.kind !== "frozen-inputs") continue;
    if (!artifact.data || typeof artifact.data !== "object") continue;
    const values =
      "values" in artifact.data && artifact.data.values && typeof artifact.data.values === "object"
        ? artifact.data.values
        : undefined;
    const locale =
      ("locale" in artifact.data ? artifact.data.locale : undefined) ??
      (values && "locale" in values ? values.locale : undefined) ??
      (values && "language" in values ? values.language : undefined) ??
      ("world" in artifact.data ? artifact.data.world : undefined);
    if (typeof locale === "string" && locale.trim()) return locale.trim();
  }
  return `case-${(job.caseIndex ?? 0) + 1}`;
}

/** The language this case ran in, ignoring the case label a combine invents. */
function caseLanguage(job: CombineEvidenceCase): string | undefined {
  const direct = (job.resolvedInputs?.locale ?? job.resolvedInputs?.language)?.trim();
  if (direct) return direct;
  for (const artifact of job.artifacts ?? []) {
    if (artifact.kind !== "frozen-inputs") continue;
    if (!artifact.data || typeof artifact.data !== "object") continue;
    const values =
      "values" in artifact.data && artifact.data.values && typeof artifact.data.values === "object"
        ? (artifact.data.values as Record<string, unknown>)
        : undefined;
    const value =
      ("locale" in artifact.data ? artifact.data.locale : undefined) ??
      values?.locale ??
      values?.language;
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

/** The locale variable and the selector columns a matrix derives from it. */
const LANGUAGE_VARIABLE_RE = /^(?:locale|language)(?:_|$)/;

/** Everything a case froze other than its language, as a comparable signature. */
function caseStateSignature(job: CombineEvidenceCase): string {
  const values = new Map<string, string>();
  const remember = (source: Record<string, unknown> | undefined): void => {
    for (const [key, value] of Object.entries(source ?? {})) {
      if (LANGUAGE_VARIABLE_RE.test(key) || value === undefined) continue;
      values.set(key, JSON.stringify(value));
    }
  };
  remember(job.resolvedInputs);
  for (const artifact of job.artifacts ?? []) {
    if (artifact.kind !== "frozen-inputs") continue;
    if (!artifact.data || typeof artifact.data !== "object") continue;
    const frozen = (artifact.data as { values?: unknown }).values;
    if (frozen && typeof frozen === "object") remember(frozen as Record<string, unknown>);
  }
  return JSON.stringify([...values].sort());
}

/**
 * Whether language is the only intended difference between the cases.
 *
 * A Combine over only a language Variable qualifies. A Combine that also
 * varies state does not: two cases in the same language
 * are supposed to read differently, and reporting that as a translation defect
 * would bury the real ones.
 *
 * Two cases in one language are only evidence of that when they also froze
 * different state. A Combine may restore the baseline locale at the end, so a
 * repeated language is a normal shape — reading it as a
 * varying combine drops the labels and returns a pack of forty rasters with
 * nothing to compare.
 */
function comparesLanguage(jobs: CombineEvidenceCase[]): boolean {
  const stateByLanguage = new Map<string, Set<string>>();
  for (const job of jobs) {
    const language = caseLanguage(job);
    if (!language) return false;
    const states = stateByLanguage.get(language) ?? new Set<string>();
    states.add(caseStateSignature(job));
    stateByLanguage.set(language, states);
  }
  return [...stateByLanguage.values()].every((states) => states.size === 1);
}

/** Dest-phase path when stamped. Unphased dest-wait uses the last non-leftover
 * caption so Transition executed / Inspect setup skipped cannot fill dest. */
function checklistDestIdentityFrame(
  job: Pick<CombineEvidenceCase, "frames" | "artifacts">,
): string | undefined {
  const phased = captureReviewIdentityFramePaths(job.artifacts ?? [])[0];
  if (phased) return phased;
  return destIdentityCheckpointFramePaths(job.frames ?? [], job.artifacts ?? []).at(-1);
}

/** Caption leftovers to drop when dest-phase is absent but dest wait-for
 * captions exist. Unphased Android dest-wait with no leftover caption keeps
 * every frame. */
function unphasedLeftoverCaptionNames(
  job: Pick<CombineEvidenceCase, "frames" | "artifacts">,
): Set<string> {
  if (captureReviewIdentityFramePaths(job.artifacts ?? []).length) return new Set();
  const dest = destIdentityCheckpointFramePaths(job.frames ?? [], job.artifacts ?? []);
  if (!dest.length) return new Set();
  return new Set(
    (job.frames ?? [])
      .filter((frame) => isCaptureReviewLeftoverCaption(frame.caption))
      .map((frame) => basename(frame.path)),
  );
}

/** Screenshots the test asked for, as opposed to automatic setup diagnostics. */
function authoredFrames(job: CombineEvidenceCase): CombineEvidenceCase["frames"] {
  let allowed: Set<string> | undefined;
  try {
    allowed = evidenceFrameNames(job).names;
  } catch {
    // A sweep still on the device has not produced its full set yet. Reading
    // partial evidence is the point of the live report; the pack still fails
    // closed on the same mismatch.
    allowed = undefined;
  }
  const dest = captureReviewIdentityFramePaths(job.artifacts ?? []);
  const leftover = new Set(
    captureReviewLeftoverLastFramePaths(job.frames ?? [], job.artifacts ?? []),
  );
  const captionLeftover = unphasedLeftoverCaptionNames(job);
  return (job.frames ?? []).filter((frame) => {
    if (isHarnessFrame(frame.caption)) return false;
    if (allowed && !allowed.has(basename(frame.path))) return false;
    if (dest.length && leftover.has(frame.path)) return false;
    if (captionLeftover.has(basename(frame.path))) return false;
    return true;
  });
}

/**
 * Findings for a batch that has not been exported.
 *
 * Same analyzer and same codes as the pack, over the evidence the runs already
 * hold, so a grid can show a verdict per cell without copying forty locales of
 * screenshots first.
 */
export async function analyzeCombineEvidenceBatch(
  batchId: string,
): Promise<CombineEvidenceAnalysisReport> {
  try {
    return analyzeCombineEvidenceJobs(batchId, await readCombineEvidenceBatchJobs(batchId));
  } catch (error) {
    const preflight = await readAccountReloginFindings(batchId);
    if (preflight) return preflight;
    throw error;
  }
}

/** A matrix batch names its recipe after itself, once per kind of matrix. */
const BATCH_ACTION_PREFIXES = ["option-run-"] as const;

/** Forty languages against forty screens, with room for the restore case. */
const MAX_BATCH_CASES = 2000;

/**
 * Every case of a batch, preferring memory and falling back to disk.
 *
 * The job registry holds a hundred jobs and dies with the process, while a sweep
 * worth exporting is hundreds of cases long and takes hours. Reading only memory
 * therefore fails two ways, and the quiet one is worse: a batch past the cap
 * still answers, having silently dropped the earliest cases — which is where the
 * baseline locale is, so the pack comes back clean because it had nothing left
 * to compare against.
 *
 * Runs are already written under one action per batch. Memory still wins per
 * case, because a sweep in flight has cases that are not on disk yet.
 *
 * Order is part of the answer, not a presentation detail: the first case is the
 * baseline every other locale is compared against. The run store lists newest
 * first, so reading it back unsorted would quietly make the restore case the
 * baseline and compare every locale against the language the sweep ended on.
 */
export async function readCombineEvidenceBatchJobs(
  batchId: string,
): Promise<CombineEvidenceCase[]> {
  const byId = new Map<string, CombineEvidenceCase>();
  for (const run of await listPersistedRuns(MAX_BATCH_CASES, undefined, batchId)) {
    byId.set(run.id, { ...run, runDir: run.dir });
  }
  for (const prefix of BATCH_ACTION_PREFIXES) {
    const persisted = await listPersistedRuns(MAX_BATCH_CASES, `${prefix}${batchId}`);
    for (const run of persisted.reverse()) {
      // A live job points at the folder it is still writing; a persisted one is
      // read back out of that same folder under the store's own name for it.
      byId.set(run.id, { ...run, runDir: run.dir });
    }
  }
  for (const job of listJobs(500)) {
    if (job.batchId === batchId) byId.set(job.id, job);
  }
  const jobs = [...byId.values()];
  if (!jobs.length) throw new Error(`no jobs found for Combine batch ${batchId}`);
  // Stable: cases that never recorded an index keep the order they were run in.
  return jobs
    .map((job, index) => ({ job, index }))
    .sort(
      (left, right) =>
        (left.job.caseIndex ?? left.index) - (right.job.caseIndex ?? right.index) ||
        left.index - right.index,
    )
    .map((entry) => entry.job);
}

/** The same report over jobs already in hand. */
export function analyzeCombineEvidenceJobs(
  batchId: string,
  jobs: CombineEvidenceCase[],
): CombineEvidenceAnalysisReport {
  const captures: CombineEvidenceCapture[] = [];
  const cases = jobs.map((job) => {
    const locale = evidenceCaseLocale(job);
    const observations = frameObservations(job);
    const frames = authoredFrames(job).map((frame, index) => {
      const observation = observations.get(basename(frame.path));
      captures.push({
        locale,
        jobId: job.id,
        index,
        packPath: frame.path,
        ...(observation?.sha256 ? { sha256: observation.sha256 } : {}),
        ...(observation ? { observation } : {}),
      });
      return {
        framePath: frame.path,
        canonicalKey: combineEvidenceCanonicalKey(index),
        ...(observation?.caption ? { caption: observation.caption } : {}),
        inspected: Boolean(observation?.controls.length),
      };
    });
    return { jobId: job.id, locale, status: job.status, frames };
  });

  const locales = [...new Set(cases.map((item) => item.locale))];
  const { analysis, coverage } = analyzeCombineEvidenceBatchData({
    batchId,
    title: jobs[0]?.title ?? "Combine evidence",
    locales,
    captures,
    compareText: comparesLanguage(jobs),
  });
  const withJobOutcomes = mergeJobOutcomeFindings(
    analysis,
    jobOutcomeFindings(jobs, evidenceCaseLocale),
  );
  return { schemaVersion: 1, batchId, locales, analysis: withJobOutcomes, coverage, cases };
}

function mergedNodesFromUnknown(value: unknown): SnapshotNode[] | undefined {
  const direct = parseFrameTreeNodes(value);
  if (direct?.length) return direct;
  if (!value || typeof value !== "object") return undefined;
  const record = value as { snapshot?: unknown; mergedNodes?: unknown };
  const fromSnapshot = parseFrameTreeNodes(record.snapshot);
  if (fromSnapshot?.length) return fromSnapshot;
  return Array.isArray(record.mergedNodes) && record.mergedNodes.length
    ? (record.mergedNodes as SnapshotNode[])
    : undefined;
}

async function readOptionalFile(path: string): Promise<Buffer | undefined> {
  try {
    return await readFile(path);
  } catch {
    return undefined;
  }
}

/** CLI survey persist writes full.png/full.json next to the viewports; a
 * Combine run may also already hold that stitch at the run root. */
async function readExistingFullPageStitch(runDir: string): Promise<{
  png?: Buffer;
  nodes?: SnapshotNode[];
}> {
  for (const dir of [runDir, join(runDir, "frames")]) {
    const png = await readOptionalFile(join(dir, "full.png"));
    let nodes: SnapshotNode[] | undefined;
    const json = await readOptionalFile(join(dir, "full.json"));
    if (json) {
      try {
        nodes = mergedNodesFromUnknown(JSON.parse(json.toString("utf8")));
      } catch {
        nodes = undefined;
      }
    }
    if (png || nodes?.length)
      return { ...(png ? { png } : {}), ...(nodes?.length ? { nodes } : {}) };
  }
  return {};
}

async function composeFullPageFromDestinationFrames(
  job: CombineEvidenceCase,
  listed: NonNullable<CombineEvidenceCase["frames"]>,
): Promise<{ png?: Buffer; nodes?: SnapshotNode[] }> {
  if (!listed.length || !job.runDir) return {};
  const frames: ScrollSurveyFrame[] = [];
  for (const [index, frame] of listed.entries()) {
    const bytes = await readOptionalFile(join(job.runDir, frame.path));
    if (!bytes) return {};
    const dims = pngDimensions(bytes);
    if (!dims) return {};
    const nodes = (await readFrameTreeNodes(job.runDir, frame.path)) ?? [];
    frames.push({
      index,
      offsetY: 0,
      appendedHeight: 0,
      screenshot: {
        base64: bytes.toString("base64"),
        width: dims.width,
        height: dims.height,
        capturedAt: frame.capturedAt ?? 0,
      },
      snapshot: {
        capturedAt: frame.capturedAt ?? 0,
        nodes,
        interactive: [],
        inspectable: true,
        source: "sdk",
        bounds: { width: dims.width, height: dims.height },
        screenIdentity: { fingerprint: "", nodes: [], volatileSignals: [] },
      },
    });
  }
  try {
    const composition = composeScrollSurveyFrames(frames);
    if (!composition?.stitched) return {};
    return {
      png: Buffer.from(composition.stitched.base64, "base64"),
      ...(composition.mergedNodes.length ? { nodes: composition.mergedNodes } : {}),
    };
  } catch {
    return {};
  }
}

/** Destination surveys persist each viewport as run evidence. The pack also
 * ships the stitched long page when that stitch already exists or can be
 * rebuilt from those frames — otherwise a reviewer only sees the first
 * viewport and misses the rest of the surface. */
async function writePackFullPage(
  job: CombineEvidenceCase,
  dest: {
    directory: string;
    screenshotDir: string;
    accessibilityDir: string;
    frames: string[];
  },
): Promise<void> {
  if (!job.runDir) return;
  const destinationFrames = (job.frames ?? []).filter((frame) =>
    (frame.caption ?? "").trim().startsWith("destination:"),
  );
  const existing = await readExistingFullPageStitch(job.runDir);
  if (!destinationFrames.length && !existing.png && !existing.nodes?.length) return;
  const composed =
    existing.png && existing.nodes?.length
      ? {}
      : await composeFullPageFromDestinationFrames(job, destinationFrames);
  const png = existing.png ?? composed.png;
  const nodes = existing.nodes ?? composed.nodes;
  if (png) {
    await writeFile(join(dest.screenshotDir, "full.png"), png);
    dest.frames.push(`${dest.directory}/screenshots/full.png`);
  }
  if (nodes?.length) {
    await mkdir(dest.accessibilityDir, { recursive: true });
    await writeFile(
      join(dest.accessibilityDir, "full.json"),
      `${JSON.stringify({ schemaVersion: 1, kind: "relay.frame-tree", nodes }, null, 2)}\n`,
      "utf8",
    );
  }
}

export async function exportCombineEvidencePack(input: {
  batchId: string;
  jobs: CombineEvidenceCase[];
  title?: string;
  recipeId?: string;
  todoItems?: readonly ReviewChecklistTodoItem[];
}): Promise<{ rootDir: string; manifest: CombineEvidencePackManifest }> {
  const batchId = input.batchId.trim();
  if (!batchId) throw new Error("batchId is required");
  const rootDir = join(combineEvidenceRoot(), batchId, "pack");
  await mkdir(rootDir, { recursive: true });

  const cases: CombineEvidencePackManifest["cases"] = [];
  const captures: CombineEvidenceCapture[] = [];
  const directoryCounts = new Map<string, number>();
  for (const job of input.jobs) {
    const key = slugEvidencePathSegment(evidenceCaseLocale(job));
    directoryCounts.set(key, (directoryCounts.get(key) ?? 0) + 1);
  }
  for (const job of input.jobs) {
    const locale = evidenceCaseLocale(job);
    const repeatedLocale = (directoryCounts.get(slugEvidencePathSegment(locale)) ?? 0) > 1;
    const directory = repeatedLocale
      ? `${slugEvidencePathSegment(locale)}/${slugEvidencePathSegment(job.id)}`
      : slugEvidencePathSegment(locale);
    const localeDir = join(rootDir, directory);
    const screenshotDir = join(localeDir, "screenshots");
    const accessibilityDir = join(localeDir, "accessibility");
    await mkdir(screenshotDir, { recursive: true });
    const frames: string[] = [];
    const evidence = evidenceFrameNames(job);
    const observations = frameObservations(job);
    // The pack ships what the test authored. Without this the two readers
    // disagree: a batch that declares no expected count would export every
    // diagnostic and analyse it, while one that declares a count would not.
    // Named as what to drop rather than what to keep, because a run read back
    // from disk need not enumerate its frames, and a frame this cannot judge is
    // better exported than silently lost.
    const harness = new Set(
      (job.frames ?? [])
        .filter((frame) => isHarnessFrame(frame.caption))
        .map((frame) => basename(frame.path)),
    );
    const destIdentity = captureReviewIdentityFramePaths(job.artifacts ?? []);
    const leftoverNames = new Set(
      captureReviewLeftoverLastFramePaths(job.frames ?? [], job.artifacts ?? []).map((path) =>
        basename(path),
      ),
    );
    const captionLeftover = unphasedLeftoverCaptionNames(job);
    if (job.runDir) {
      try {
        const frameDir = join(job.runDir, "frames");
        const entries = (await readdir(frameDir))
          .filter(
            (name) =>
              name.endsWith(".png") &&
              name !== "full.png" &&
              !harness.has(name) &&
              !(destIdentity.length && leftoverNames.has(name)) &&
              !captionLeftover.has(name) &&
              (!evidence.names || evidence.names.has(name)),
          )
          .sort();
        for (const [index, name] of entries.entries()) {
          const destName = `${String(index + 1).padStart(3, "0")}-${name}`;
          const bytes = await readFile(join(frameDir, name));
          await writeFile(join(screenshotDir, destName), bytes);
          const packPath = `${directory}/screenshots/${destName}`;
          frames.push(packPath);
          const observation = observations.get(name);
          const nodes = await readFrameTreeNodes(job.runDir, `frames/${name}`);
          if (nodes?.length) {
            await mkdir(accessibilityDir, { recursive: true });
            const treeName = destName.replace(/\.png$/iu, ".json");
            await writeFile(
              join(accessibilityDir, treeName),
              `${JSON.stringify({ schemaVersion: 1, kind: "relay.frame-tree", nodes }, null, 2)}\n`,
              "utf8",
            );
          }
          captures.push({
            locale,
            jobId: job.id,
            index,
            packPath,
            sha256: createHash("sha256").update(bytes).digest("hex"),
            ...(observation ? { observation } : {}),
            ...(nodes?.length ? { nodes } : {}),
          });
        }
      } catch {
        // frames optional
      }
      await writePackFullPage(job, { directory, screenshotDir, accessibilityDir, frames });
    }
    const coverageNote = describeCoverageStepReasons(
      coverageOutcomesFromArtifacts(job.artifacts ?? []),
    );
    cases.push({
      locale,
      jobId: job.id,
      status: job.status,
      name: job.title ?? job.action,
      frames,
      ...(evidence.expected !== undefined ? { expectedFrames: evidence.expected } : {}),
      ...(coverageNote ? { note: coverageNote } : {}),
    });
  }

  const locales = [...new Set(cases.map((item) => item.locale))];
  const title = input.title ?? input.jobs[0]?.title ?? "Combine evidence";
  const analyzed = analyzeCombineEvidenceBatchData({
    batchId,
    title,
    locales,
    captures,
    compareText: comparesLanguage(input.jobs),
  });
  const analysis = mergeJobOutcomeFindings(
    analyzed.analysis,
    jobOutcomeFindings(input.jobs, evidenceCaseLocale),
  );
  const { byCanonicalKey, frames, coverage } = analyzed;
  const framesByPath = new Map(frames.map((frame) => [frame.path, frame]));

  const content = compareCapturedContent(captures);
  for (const page of content.pages) {
    if (!page.text) continue;
    const textPath = page.path
      .replace("/screenshots/", "/accessibility/")
      .replace(/\.png$/iu, ".txt");
    await writeFile(join(rootDir, textPath), page.text, "utf8");
  }
  const manifest: CombineEvidencePackManifest = {
    content: {
      ...content,
      pages: content.pages.map((page) => ({
        ...page,
        ...(page.text
          ? {
              textPath: page.path
                .replace("/screenshots/", "/accessibility/")
                .replace(/\.png$/iu, ".txt"),
              accessibilityPath: page.path
                .replace("/screenshots/", "/accessibility/")
                .replace(/\.png$/iu, ".json"),
            }
          : {}),
      })),
    },
    schemaVersion: 2,
    batchId,
    recipeId: input.recipeId ?? input.jobs[0]?.recipeId ?? "unknown",
    title,
    generatedAt: Date.now(),
    locales,
    cases: cases.map((item) => {
      const captured = item.frames.flatMap((path) => {
        const frame = framesByPath.get(path);
        return frame ? [frame] : [];
      });
      return { ...item, ...(captured.length ? { captures: captured } : {}) };
    }),
    byCanonicalKey,
    analysis,
    analysisCoverage: coverage,
  };
  await writeFile(join(rootDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  const captureReview = captureReviewQueueForCases(input.jobs);
  const captureReviewHeadline = captureReview.items.length
    ? formatCaptureReviewCoverageSummary(captureReview.summary)
    : undefined;
  const pendingReviewJobIds = new Set(
    captureReview.items
      .filter(
        (item) =>
          item.status === "pending" ||
          item.status === "missing" ||
          item.status === "need-more-evidence",
      )
      .flatMap((item) => (item.runId ? [item.runId] : [])),
  );
  const destIdentityByJob = new Map(
    input.jobs.map((job) => [job.id, checklistDestIdentityFrame(job)]),
  );
  const checklistRows = reviewChecklistRows({
    cases: manifest.cases.map((item) => ({
      ...item,
      ...(destIdentityByJob.get(item.jobId)
        ? { destIdentityFrame: destIdentityByJob.get(item.jobId) }
        : {}),
    })),
    findings: analysis.findings,
    visualComparisonByJobId: await readVisualComparisonIdsByRunId(runsRoot()),
    todoItems: input.todoItems,
    pendingReviewJobIds,
  });
  await writeFile(
    join(rootDir, "index.html"),
    await writeReviewChecklistFiles(
      rootDir,
      portablePackHtml(manifest, captureReviewHeadline).replace(
        "<main>",
        '<main><p><a href="comparison.html">Compare screens side by side</a></p>',
      ),
      checklistRows,
      captureReviewHeadline ? { captureReview: captureReviewHeadline } : undefined,
    ),
    "utf8",
  );
  await writeFile(join(rootDir, "comparison.html"), comparisonHtml(manifest), "utf8");
  await writeFile(
    join(rootDir, "README.md"),
    [
      `# ${manifest.title}`,
      "",
      `Batch: ${batchId}`,
      `Locales: ${manifest.locales.join(", ")}`,
      `Findings: ${analysis.findings.length} (${analysis.critical} critical) against ${analysis.baselineLocale}`,
      `Frames read: ${coverage.inspectedFrames} of ${coverage.frames} carried a UI tree`,
      ...(captureReviewHeadline
        ? [
            `Capture review: ${captureReviewHeadline}`,
            "Looks correct does not approve a visual baseline.",
          ]
        : []),
      "",
      captureReviewHeadline
        ? "Open index.html for planned / captured / blocked + pending review. Execution ok is not visual acceptance. Looks correct does not approve a visual baseline."
        : "Open index.html for the Test checklist (passed | check failed | could not run | todo) and the frame report. Confirm and Reject never accept a visual baseline; use `relay run visual review <job>`. Each folder is one matrix case: screenshots/ are the rasters (full.png is the stitched long page when a destination survey or stitch was captured), accessibility/ holds the raw tree beside each PNG when one was captured.",
      "manifest.json carries the same findings under `analysis`, and `byCanonicalKey` maps each one to the frame it came from.",
      "",
    ].join("\n"),
    "utf8",
  );
  return { rootDir, manifest };
}

export async function exportCombineEvidencePackFromBatchId(batchId: string): Promise<{
  rootDir: string;
  manifest: CombineEvidencePackManifest;
  jobs: CombineEvidenceCase[];
}> {
  const jobs = await readCombineEvidenceBatchJobs(batchId);
  const exported = await exportCombineEvidencePack({ batchId, jobs });
  return { ...exported, jobs };
}

/**
 * Exporting a matrix batch as a pack a person can open.
 *
 * The pack is the deliverable of a locale sweep: one folder per case, the
 * authored screenshots in order, the findings computed from those same frames
 * and the trees captured beside them, and a portable HTML page that shows both
 * together.
 */
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import type {
  CorpusFinding,
  LocaleRunAnalysisReport,
  LocaleRunPackManifest,
} from "@relay/protocol";
import { frameObservations } from "./frame-observation.js";
import { readFrameTreeNodes } from "./run-frame-tree.js";
import {
  analyzeLocaleRunPack,
  localeRunCanonicalKey,
  type LocaleRunPackCapture,
} from "./locale-run-analysis.js";
import { listPersistedRuns } from "./runs.js";
import { slugCorpusPathSegment } from "./screen-identity.js";
import { listJobs, type TestJob } from "./session.js";
import { findWorkspaceRoot } from "./workspace-root.js";

export type { LocaleRunPackManifest };

/**
 * A matrix case as the pack reads it.
 *
 * The live registry hands back a `TestJob`; the run store hands back the
 * `PersistedRun` written from one. They agree on everything a locale sweep is
 * evidence for — the frames, the artifacts, the case index — and differ only in
 * fields describing how the job was dispatched, which no finding depends on.
 * Naming the overlap lets one analyzer read a batch whether it is still in
 * memory or only on disk, without a cast that claims more than either type has.
 */
export type LocaleRunCase = Pick<
  TestJob,
  | "id"
  | "action"
  | "batchId"
  | "caseIndex"
  | "artifacts"
  | "frames"
  | "steps"
  | "resolvedInputs"
  | "recipeId"
  | "runDir"
> & {
  /** Widened from `JobStatus`: the run store reads its own files back as text,
   * and the pack only ever reports this status, never branches on it. */
  status: string;
  /** Optional on a persisted run; every reader here already falls back. */
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

function findingLine(manifest: LocaleRunPackManifest, finding: CorpusFinding): string {
  const frame = manifest.byCanonicalKey[finding.canonicalKey]?.[finding.locale];
  const detail = escapeHtml(finding.detail);
  const body = frame ? `<a href="${encodePath(frame)}">${detail}</a>` : detail;
  return `<li data-severity="${escapeHtml(finding.severity)}"><code>${escapeHtml(finding.code)}</code> ${body} <em>${escapeHtml(finding.confidence)} confidence</em></li>`;
}

function portablePackHtml(manifest: LocaleRunPackManifest): string {
  const passed = manifest.cases.filter((item) => item.status === "ok" || item.status === "healed");
  const expected = manifest.cases.reduce((total, item) => total + (item.expectedFrames ?? 0), 0);
  const captured = manifest.cases.reduce((total, item) => total + item.frames.length, 0);
  const { analysis, analysisCoverage } = manifest;
  const byLocale = new Map<string, CorpusFinding[]>();
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
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(manifest.title)}</title>
<style>:root{color-scheme:light dark;font:14px ui-sans-serif,system-ui,sans-serif;background:#f7f7f8;color:#18181b}*{box-sizing:border-box}body{margin:0}main{max-width:1440px;margin:auto;padding:32px}h1{font-size:24px;letter-spacing:-.03em;margin:0 0 6px}.summary{color:#64646c;margin:0 0 28px}.case{background:#fff;border:1px solid #dedee3;border-radius:14px;margin:0 0 16px;overflow:hidden}.case>header{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:12px 14px;border-bottom:1px solid #e8e8eb}.case header div{display:grid;gap:2px}.case header span{font-size:12px;color:#71717a}.case header b{font-size:11px;text-transform:capitalize}.case header b[data-status=error],.case header b[data-status=cancelled]{color:#c2410c}.frames{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:10px;padding:10px}.frames figure{position:relative;margin:0;border-radius:9px;overflow:hidden;background:#eee;min-height:120px}.frames img{display:block;width:100%;height:240px;object-fit:contain}.frames figcaption{position:absolute;right:6px;bottom:6px;border-radius:99px;background:#000b;color:white;padding:3px 7px;font-size:10px}.empty{color:#71717a;padding:20px}.findings{margin:0;padding:4px 14px 14px 30px;display:grid;gap:6px}.findings li{font-size:12px}.findings li[data-severity=critical]{color:#b91c1c}.findings code{font-size:11px;background:#f1f1f4;border-radius:5px;padding:1px 5px}.findings em{color:#71717a;font-style:normal}.clean{margin:0;padding:4px 14px 14px;font-size:12px;color:#71717a}@media(prefers-color-scheme:dark){:root{background:#171719;color:#f4f4f5}.case{background:#222225;border-color:#39393f}.case>header{border-color:#39393f}.case header span,.summary,.empty,.clean{color:#a1a1aa}.frames figure{background:#111}.findings code{background:#2e2e33}.findings li[data-severity=critical]{color:#fca5a5}}</style></head>
<body><main><h1>${escapeHtml(manifest.title)}</h1><p class="summary">${passed.length} of ${manifest.cases.length} runs passed · ${captured}${expected ? ` of ${expected}` : ""} screenshots · ${analysis.findings.length} finding${analysis.findings.length === 1 ? "" : "s"} (${analysis.critical} critical) against ${escapeHtml(analysis.baselineLocale)}${blind ? ` · ${blind} frame${blind === 1 ? "" : "s"} without a UI tree, checked for presence only` : ""} · ${new Date(manifest.generatedAt).toISOString()}</p>${cards}</main></body></html>\n`;
}

function expectedEvidenceFrames(job: LocaleRunCase): number | undefined {
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
export function evidenceFrameNames(job: LocaleRunCase): {
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

function localeRunRoot(): string {
  return join(
    process.env.RELAY_WORKSPACE_ROOT?.trim() || findWorkspaceRoot(),
    ".relay",
    "locale-runs",
  );
}

export function artifactLocale(job: LocaleRunCase): string {
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
function caseLanguage(job: LocaleRunCase): string | undefined {
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
function caseStateSignature(job: LocaleRunCase): string {
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
 * A locale matrix qualifies, and so does a combine over a language variable.
 * A combine that also varies state does not: two cases in the same language
 * are supposed to read differently, and reporting that as a translation defect
 * would bury the real ones.
 *
 * Two cases in one language are only evidence of that when they also froze
 * different state. A matrix restores the baseline locale at the end, so a
 * repeated language is the normal shape of every sweep — reading it as a
 * varying combine drops the labels and returns a pack of forty rasters with
 * nothing to compare.
 */
function comparesLanguage(jobs: LocaleRunCase[]): boolean {
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

/** Screenshots the test asked for, as opposed to automatic setup diagnostics. */
function authoredFrames(job: LocaleRunCase): LocaleRunCase["frames"] {
  let allowed: Set<string> | undefined;
  try {
    allowed = evidenceFrameNames(job).names;
  } catch {
    // A sweep still on the device has not produced its full set yet. Reading
    // partial evidence is the point of the live report; the pack still fails
    // closed on the same mismatch.
    allowed = undefined;
  }
  return (job.frames ?? []).filter(
    (frame) => !isHarnessFrame(frame.caption) && (!allowed || allowed.has(basename(frame.path))),
  );
}

/**
 * Findings for a batch that has not been exported.
 *
 * Same analyzer and same codes as the pack, over the evidence the runs already
 * hold, so a grid can show a verdict per cell without copying forty locales of
 * screenshots first.
 */
export async function analyzeLocaleRunBatch(batchId: string): Promise<LocaleRunAnalysisReport> {
  return analyzeLocaleRunJobs(batchId, await localeBatchJobs(batchId));
}

/** A matrix batch names its recipe after itself, once per kind of matrix. */
const BATCH_ACTION_PREFIXES = ["locale-run-", "option-run-"] as const;

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
async function localeBatchJobs(batchId: string): Promise<LocaleRunCase[]> {
  const byId = new Map<string, LocaleRunCase>();
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
  if (!jobs.length) throw new Error(`no jobs found for locale batch ${batchId}`);
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
export function analyzeLocaleRunJobs(
  batchId: string,
  jobs: LocaleRunCase[],
): LocaleRunAnalysisReport {
  const captures: LocaleRunPackCapture[] = [];
  const cases = jobs.map((job) => {
    const locale = artifactLocale(job);
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
        canonicalKey: localeRunCanonicalKey(index),
        ...(observation?.caption ? { caption: observation.caption } : {}),
        inspected: Boolean(observation?.controls.length),
      };
    });
    return { jobId: job.id, locale, status: job.status, frames };
  });

  const locales = [...new Set(cases.map((item) => item.locale))];
  const { analysis, coverage } = analyzeLocaleRunPack({
    batchId,
    title: jobs[0]?.title ?? "Locale run",
    locales,
    captures,
    compareText: comparesLanguage(jobs),
  });
  return { schemaVersion: 1, batchId, locales, analysis, coverage, cases };
}

export async function exportLocaleRunPack(input: {
  batchId: string;
  jobs: LocaleRunCase[];
  title?: string;
  recipeId?: string;
}): Promise<{ rootDir: string; manifest: LocaleRunPackManifest }> {
  const batchId = input.batchId.trim();
  if (!batchId) throw new Error("batchId is required");
  const rootDir = join(localeRunRoot(), batchId, "pack");
  await mkdir(rootDir, { recursive: true });

  const cases: LocaleRunPackManifest["cases"] = [];
  const captures: LocaleRunPackCapture[] = [];
  for (const job of input.jobs) {
    const locale = artifactLocale(job);
    const localeDir = join(rootDir, slugCorpusPathSegment(locale));
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
    if (job.runDir) {
      try {
        const frameDir = join(job.runDir, "frames");
        const entries = (await readdir(frameDir))
          .filter(
            (name) =>
              name.endsWith(".png") &&
              !harness.has(name) &&
              (!evidence.names || evidence.names.has(name)),
          )
          .sort();
        for (const [index, name] of entries.entries()) {
          const destName = `${String(index + 1).padStart(3, "0")}-${name}`;
          const bytes = await readFile(join(frameDir, name));
          await writeFile(join(screenshotDir, destName), bytes);
          const packPath = `${slugCorpusPathSegment(locale)}/screenshots/${destName}`;
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
    }
    cases.push({
      locale,
      jobId: job.id,
      status: job.status,
      name: job.title ?? job.action,
      frames,
      ...(evidence.expected !== undefined ? { expectedFrames: evidence.expected } : {}),
    });
  }

  const locales = [...new Set(cases.map((item) => item.locale))];
  const title = input.title ?? input.jobs[0]?.title ?? "Locale run";
  const { analysis, byCanonicalKey, frames, coverage } = analyzeLocaleRunPack({
    batchId,
    title,
    locales,
    captures,
    compareText: comparesLanguage(input.jobs),
  });
  const framesByPath = new Map(frames.map((frame) => [frame.path, frame]));

  const manifest: LocaleRunPackManifest = {
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
  await writeFile(join(rootDir, "index.html"), portablePackHtml(manifest), "utf8");
  await writeFile(
    join(rootDir, "README.md"),
    [
      `# ${manifest.title}`,
      "",
      `Batch: ${batchId}`,
      `Locales: ${manifest.locales.join(", ")}`,
      `Findings: ${analysis.findings.length} (${analysis.critical} critical) against ${analysis.baselineLocale}`,
      `Frames read: ${coverage.inspectedFrames} of ${coverage.frames} carried a UI tree`,
      "",
      "Open index.html for a portable visual report. Each folder is one matrix case: screenshots/ are the rasters, accessibility/ holds the raw tree beside each PNG when one was captured.",
      "manifest.json carries the same findings under `analysis`, and `byCanonicalKey` maps each one to the frame it came from.",
      "",
    ].join("\n"),
    "utf8",
  );
  return { rootDir, manifest };
}

export async function exportLocaleRunPackFromBatchId(batchId: string): Promise<{
  rootDir: string;
  manifest: LocaleRunPackManifest;
  jobs: LocaleRunCase[];
}> {
  const jobs = await localeBatchJobs(batchId);
  const exported = await exportLocaleRunPack({ batchId, jobs });
  return { ...exported, jobs };
}

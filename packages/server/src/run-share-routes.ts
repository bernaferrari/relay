import { createHash } from "node:crypto";
import type http from "node:http";
import {
  buildRunShareReport,
  publicShareBaseUrl,
  readFrameFile,
  readPersistedRun,
  resolveRunShareTokenState,
  runsRoot,
  type PersistedRun,
} from "@relay/core";
import type { RunShareReport, RunShareReportRun } from "@relay/protocol";
import { destIdentitySourceFrames } from "@relay/protocol";
import { CORS_HEADERS, json, matchPath } from "./http.js";

const PUBLIC_HEADERS = {
  "Cache-Control": "private, no-store",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
} as const;

function shareableFrames(run: PersistedRun): PersistedRun["frames"] {
  const pngs = run.frames.filter(
    (frame) => frame.mime === "image/png" || frame.path.toLowerCase().endsWith(".png"),
  );
  return destIdentitySourceFrames(pngs, run.artifacts);
}

function recordedShareFrameDigests(run: PersistedRun, framePath: string): string[] {
  const digests = new Set<string>();
  const file = framePath.split("/").at(-1);
  for (const artifact of run.artifacts ?? []) {
    if (artifact.kind !== "capture-review") continue;
    const data = artifact.data;
    if (!data || typeof data !== "object" || Array.isArray(data)) continue;
    if (!("framePath" in data) || !("imageSha256" in data)) continue;
    const recordedPath = data.framePath;
    const imageSha256 = data.imageSha256;
    if (typeof recordedPath !== "string" || typeof imageSha256 !== "string" || !imageSha256) {
      continue;
    }
    if (recordedPath === framePath || recordedPath.endsWith(`/${file}`)) digests.add(imageSha256);
  }
  return [...digests];
}

async function blockedShareFrameKeys(runs: readonly PersistedRun[]): Promise<Set<string>> {
  const blocked = new Set<string>();
  for (const run of runs) {
    const frames = shareableFrames(run);
    for (const [index, frame] of frames.entries()) {
      const expected = recordedShareFrameDigests(run, frame.path);
      if (expected.length === 0) continue;
      const buffer = await readFrameFile(run.dir, frame.path);
      const actual = buffer ? createHash("sha256").update(buffer).digest("hex") : "";
      if (!buffer || expected.some((digest) => digest !== actual))
        blocked.add(`${run.id}:${index}`);
    }
  }
  return blocked;
}

function annotateWithheldFrames(
  report: RunShareReport,
  blocked: readonly string[],
): RunShareReport {
  if (blocked.length === 0) return report;
  const withheld = new Set(blocked);
  const runs = report.runs.map((run) => ({
    ...run,
    frames: run.frames.map((frame) =>
      withheld.has(`${run.id}:${frame.index}`) ? { ...frame, withheld: true as const } : frame,
    ),
  }));
  const withheldCount = runs.reduce(
    (total, run) => total + run.frames.filter((frame) => frame.withheld).length,
    0,
  );
  return {
    ...report,
    totals: {
      ...report.totals,
      screenshots: Math.max(0, report.totals.screenshots - withheldCount),
    },
    runs,
  };
}

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function dateTime(value: number): string {
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function duration(value?: number): string {
  if (value === undefined) return "—";
  if (value < 1_000) return `${Math.round(value)} ms`;
  if (value < 60_000) return `${(value / 1_000).toFixed(value < 10_000 ? 1 : 0)} s`;
  return `${Math.floor(value / 60_000)}m ${Math.round((value % 60_000) / 1_000)}s`;
}

function resultTone(run: RunShareReportRun): "pass" | "problem" | "neutral" {
  if (run.outcome !== undefined) return run.outcome === "passed" ? "pass" : "problem";
  if (run.status === "ok" || run.status === "healed") {
    return "pass";
  }
  if (run.status === "queued" || run.status === "running" || run.status === "paused") {
    return "neutral";
  }
  return "problem";
}

function runLabel(run: RunShareReportRun): string {
  return run.caseIndex !== undefined && run.caseCount
    ? `Case ${run.caseIndex + 1} of ${run.caseCount}`
    : run.title;
}

function proofEntry(label: string, value: string): string {
  return `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`;
}

/** The "What this proves" identity block. Only fields actually recorded on
 * the runs appear; absent facts never render as placeholders. */
function proofBlock(report: RunShareReport): string {
  const provenance = report.provenance;
  if (!provenance) return "";
  const entries = [
    ...(provenance.appVersion ? [proofEntry("App version", provenance.appVersion)] : []),
    ...(provenance.platform
      ? [
          proofEntry(
            "Execution target",
            [
              provenance.platform,
              provenance.profileId ? `profile ${provenance.profileId}` : undefined,
              provenance.deviceName,
            ]
              .filter(Boolean)
              .join(" · "),
          ),
        ]
      : []),
    ...(provenance.appMapRevision !== undefined
      ? [proofEntry("App Map revision", `r${provenance.appMapRevision}`)]
      : []),
    ...(provenance.sourceRevision
      ? [
          proofEntry(
            "Source",
            provenance.sourceRevision.prNumber !== undefined
              ? `${provenance.sourceRevision.sha.slice(0, 12)} (PR #${provenance.sourceRevision.prNumber})`
              : provenance.sourceRevision.sha.slice(0, 12),
          ),
        ]
      : []),
    ...(provenance.startedAt ? [proofEntry("Started", dateTime(provenance.startedAt))] : []),
    ...(provenance.completedAt ? [proofEntry("Completed", dateTime(provenance.completedAt))] : []),
    ...(provenance.completedAt && provenance.startedAt
      ? [proofEntry("Total duration", duration(provenance.completedAt - provenance.startedAt))]
      : []),
  ];
  if (entries.length === 0) return "";
  return `<section aria-label="What this proves"><div class="section-title"><h2>What this proves</h2></div><dl class="proof">${entries.join("")}</dl></section>`;
}

/** Human review rides beside the machine totals. A passing run with reported
 * issues shows both facts; neither erases the other. */
function reviewBlock(report: RunShareReport): string {
  const review = report.captureReview;
  if (!review) return "";
  const items = [
    ...(review.pending ? [`${review.pending} awaiting screenshot review`] : []),
    ...(review.accepted ? [`${review.accepted} reviewed as correct`] : []),
    ...(review.issue
      ? [`${review.issue} reported ${review.issue === 1 ? "issue" : "issues"}`]
      : []),
    ...(review.needMoreEvidence ? [`${review.needMoreEvidence} need more evidence`] : []),
    ...(review.missing
      ? [`${review.missing} missing ${review.missing === 1 ? "capture" : "captures"}`]
      : []),
  ];
  if (items.length === 0) return "";
  return `<p class="review-status" aria-label="Screenshot review totals">${items.map(escapeHtml).join(" · ")}</p>`;
}

function screenshotLabel(caption: string): string {
  return caption.replace(/^step:[^:]*:/u, "").replace(/^final:/u, "");
}

const styleBlock = `:root{color-scheme:light dark;font-family:Inter,ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#f7f7f8;color:#17171b;font-synthesis:none}*{box-sizing:border-box}body{margin:0;background:linear-gradient(180deg,#fff 0,#f7f7f8 320px);min-height:100vh;-webkit-font-smoothing:antialiased}main{width:min(1180px,calc(100% - 32px));margin:0 auto;padding:32px 0 80px}.top{display:flex;align-items:flex-start;justify-content:space-between;gap:32px;margin-bottom:24px}.brand{font-size:13px;font-weight:650;letter-spacing:-.01em}.brand b{display:inline-grid;place-items:center;width:24px;height:24px;margin-right:8px;border-radius:7px;background:#2547f5;color:white}.eyebrow{margin:20px 0 8px;color:#65656f;font-size:12px;font-weight:600;letter-spacing:.08em;text-transform:uppercase}h1{margin:0;max-width:760px;font-size:clamp(28px,4vw,40px);line-height:1.15;letter-spacing:-.045em;text-wrap:balance}.expires{color:#65656f;font-size:12px;white-space:nowrap}.metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:1px;overflow:hidden;margin:0 0 28px;border:1px solid rgb(0 0 0/.08);border-radius:14px;background:rgb(0 0 0/.08)}.metric{padding:18px;background:#fff}.metric strong{display:block;font-size:24px;letter-spacing:-.035em;font-variant-numeric:tabular-nums}.metric span{display:block;margin-top:3px;color:#6c6c75;font-size:12px}.section-title{display:flex;align-items:baseline;justify-content:space-between;gap:16px;margin:36px 0 12px}.section-title h2{margin:0;font-size:17px;letter-spacing:-.02em}.section-title span{color:#777780;font-size:12px}.runs{list-style:none;margin:0;padding:0;border:1px solid rgb(0 0 0/.08);border-radius:12px;background:#fff}.runs li{display:grid;grid-template-columns:10px minmax(180px,1fr) minmax(80px,140px) 72px;align-items:center;gap:12px;min-height:44px;padding:0 14px;border-bottom:1px solid rgb(0 0 0/.07);font-size:12px}.runs li:last-child{border:0}.runs li>span{color:#707079}.runs strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.number{text-align:right;font-variant-numeric:tabular-nums}.status{width:7px;height:7px;border-radius:50%;background:#9b9ba3}.status.pass{background:#16a36a}.status.problem{background:#d94835}.screen{overflow:hidden;margin:12px 0;border:1px solid rgb(0 0 0/.08);border-radius:14px;background:#fff}.screen summary{display:grid;grid-template-columns:1fr auto 20px;align-items:center;gap:12px;min-height:54px;padding:0 16px;cursor:pointer;list-style:none;font-size:14px;font-weight:600}.screen summary::-webkit-details-marker{display:none}.screen summary small{color:#777780;font-size:11px;font-weight:500}.screen summary i{font-size:16px;font-style:normal;transition:transform .15s ease}.screen[open] summary i{transform:rotate(180deg)}.shots{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,260px),1fr));gap:12px;padding:0 12px 12px}.shot{min-width:0;margin:0;overflow:hidden;border:1px solid rgb(0 0 0/.08);border-radius:10px;background:#fafafa}.shot-frame{display:flex;align-items:center;justify-content:center;height:360px;overflow:hidden;background:linear-gradient(135deg,#f0f0f2,#fafafa)}.shot img{display:block;min-width:0;min-height:0;width:100%;height:100%;object-fit:contain}.shot figcaption{display:grid;gap:2px;padding:9px 10px;border-top:1px solid rgb(0 0 0/.07);font-size:12px}.shot figcaption strong,.shot figcaption span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.shot figcaption span{color:#74747d}.privacy{margin:32px 0 0;color:#777780;font-size:11px;line-height:1.5}.privacy strong{color:#44444c}@media(max-width:620px){main{width:min(100% - 20px,1180px);padding-top:24px}.top{display:block}.expires{display:block;margin-top:16px}.metrics{grid-template-columns:repeat(2,1fr)}.runs li{grid-template-columns:10px 1fr 64px}.runs li>span:nth-of-type(2){display:none}.shot-frame{height:210px}}@media(prefers-color-scheme:dark){:root{background:#111114;color:#f4f4f5}body{background:linear-gradient(180deg,#17171b 0,#111114 320px)}.metrics,.runs,.screen,.shot{border-color:#2a2a30}.metrics{background:#2a2a30}.metric,.runs,.screen{background:#19191d}.runs li,.shot figcaption{border-color:#29292f}.shot{background:#151519}.shot-frame{background:linear-gradient(135deg,#111114,#1b1b20)}.expires,.eyebrow,.section-title span,.metric span,.runs li>span,.screen summary small,.shot figcaption span,.privacy{color:#9a9aa4}.privacy strong{color:#d2d2d7}}@media(prefers-reduced-motion:reduce){*{scroll-behavior:auto!important;transition:none!important}}.runs li .why{display:block;margin-top:3px;color:#d94835;font-size:11px;line-height:1.45;white-space:normal;overflow-wrap:anywhere}@media(prefers-color-scheme:dark){.runs li .why{color:#f28b7c}}`;

export function renderRunShareReportHtml(
  report: RunShareReport,
  token: string,
  blockedShareFrames: readonly string[] = [],
): string {
  const blockedKeys = new Set(blockedShareFrames);
  const maxScreens = Math.max(0, ...report.runs.map((run) => run.frames.length));
  const screenSections = Array.from({ length: maxScreens }, (_, index) => {
    const screenIndex = maxScreens - index - 1;
    const captions = new Set(
      report.runs.flatMap((run) => {
        const frame = run.frames[screenIndex];
        return frame ? [screenshotLabel(frame.caption)] : [];
      }),
    );
    const screenTitle = captions.size === 1 ? [...captions][0] : `Screenshot ${screenIndex + 1}`;
    const variants = report.runs.flatMap((run) => {
      const frame = run.frames[screenIndex];
      if (!frame) return [];
      const blocked = frame.withheld || blockedKeys.has(`${run.id}:${screenIndex}`);
      if (blocked) {
        return [
          `<figure class="shot">
          <div class="shot-frame"><p>This recorded frame was not embedded because its bytes do not match the recorded digest.</p></div>
          <figcaption><strong>${escapeHtml(runLabel(run))}</strong><span>${escapeHtml(frame.caption)}</span></figcaption>
        </figure>`,
        ];
      }
      const source = `/shared/runs/${encodeURIComponent(token)}/frames/${encodeURIComponent(run.id)}/${frame.index}`;
      return [
        `<figure class="shot">
          <div class="shot-frame"><img src="${source}" alt="${escapeHtml(screenshotLabel(frame.caption))} — ${escapeHtml(runLabel(run))}" loading="${index === 0 ? "eager" : "lazy"}" decoding="async"></div>
          <figcaption>${report.runs.length > 1 ? `<strong>${escapeHtml(runLabel(run))}</strong>` : ""}${captions.size > 1 ? `<span>${escapeHtml(screenshotLabel(frame.caption))}</span>` : ""}<a href="${source}" target="_blank" rel="noopener">Open screenshot</a></figcaption>
        </figure>`,
      ];
    });
    return `<details class="screen"${index === 0 ? " open" : ""}>
      <summary><span>${escapeHtml(screenTitle)}</span><small>${variants.length > 1 ? `${variants.length} variants · ` : ""}${screenIndex + 1} of ${maxScreens}</small><i aria-hidden="true">⌄</i></summary>
      <div class="shots">${variants.join("")}</div>
    </details>`;
  }).join("");
  const runRows = report.runs
    .map(
      (run) => `<li>
        <span class="status ${resultTone(run)}" aria-label="${escapeHtml(run.outcome ?? run.status)}"></span>
        <div><strong>${escapeHtml(runLabel(run))}</strong>${
          run.failedStep
            ? `<span class="failed-at">Failed at step ${run.failedStep.index + 1} of ${run.failedStep.total}: ${escapeHtml(run.failedStep.label)}</span>`
            : ""
        }${
          run.errorHeadline
            ? `<span class="why">Why it stopped: ${escapeHtml(run.errorHeadline)}</span>`
            : ""
        }</div>
        <span>${escapeHtml(run.platform ?? "Target")}</span>
        <span class="number">${duration(run.durationMs)}</span>
      </li>`,
    )
    .join("");
  const baseUrl = publicShareBaseUrl();
  const withheldCount = report.runs.reduce(
    (total, run) => total + run.frames.filter((frame) => frame.withheld).length,
    0,
  );
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
${baseUrl ? `<link rel="canonical" href="${escapeHtml(new URL(`/shared/runs/${encodeURIComponent(token)}`, baseUrl).toString())}">` : ""}
<title>${escapeHtml(report.share.title)} · Relay</title>
<style>
${styleBlock}
.proof{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:1px;overflow:hidden;margin:0 0 28px;border:1px solid rgb(0 0 0/.08);border-radius:14px;background:rgb(0 0 0/.08)}.proof div{padding:12px 14px;background:#fff}.proof dt{margin:0;color:#777780;font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase}.proof dd{margin:3px 0 0;font-size:13px;font-variant-numeric:tabular-nums;overflow-wrap:anywhere}@media(prefers-color-scheme:dark){.proof{border-color:#2a2a30;background:#2a2a30}.proof div{background:#19191d}}
.runs li .failed-at{display:block;margin-top:3px;color:#8a5a00;font-size:11px;line-height:1.45}@media(prefers-color-scheme:dark){.runs li .failed-at{color:#d9a53f}}
.brand{margin-bottom:16px}.outcome{margin:0;font-size:15px;line-height:1.5;font-weight:600}.review-status{margin:6px 0 24px;font-size:14px;line-height:1.5;color:#65656f}.shots:has(>figure:only-child) .shot-frame{height:clamp(240px,calc(100dvh - 350px),600px)}.shot figcaption a{justify-self:start;min-height:44px;display:inline-flex;align-items:center;color:inherit;text-underline-offset:3px}.screen summary>span{overflow-wrap:anywhere}.report-details{margin-top:32px}.report-details>summary{min-height:44px;display:list-item;cursor:pointer;font-size:14px;color:#65656f}.screen summary:focus-visible,.report-details>summary:focus-visible,.shot a:focus-visible{outline:2px solid currentColor;outline-offset:-4px;border-radius:4px}@media(prefers-color-scheme:dark){.review-status,.report-details>summary{color:#9a9aa4}}@media(max-width:620px){main{padding-top:24px}.top{margin-bottom:20px}.expires{white-space:normal}.section-title{align-items:flex-start}.section-title span{max-width:45%;text-align:right}.shots:has(>figure:only-child) .shot-frame{height:clamp(220px,calc(100dvh - 460px),420px)}}
.report-layout{display:grid;grid-template-columns:240px minmax(0,1fr);gap:32px;align-items:start}.report-context .top{display:block}.report-context h1{font-size:28px;line-height:1.2}.report-context .expires{display:block;white-space:normal;line-height:1.5;margin-top:20px}.report-context .metrics{grid-template-columns:repeat(2,minmax(0,1fr))}.report-context .runs li{grid-template-columns:10px minmax(0,1fr) 48px}.report-context .runs li>span:nth-of-type(2){display:none}.report-gallery>.section-title{margin-top:0}.report-gallery .shots:has(>figure:only-child) .shot-frame{height:clamp(280px,calc(100dvh - 220px),720px)}@media(max-width:900px){.report-layout{grid-template-columns:minmax(0,1fr);gap:24px}.report-context .review-status{margin-bottom:0}.report-context .report-details{margin-top:12px}.report-gallery .shots:has(>figure:only-child) .shot-frame{height:clamp(240px,calc(100dvh - 350px),540px)}}
</style></head><body><main>
<div class="report-layout"><header class="report-context">
<div class="top"><div><div class="brand"><b>R</b>Relay evidence</div><h1>${escapeHtml(report.share.title)}</h1></div></div>
<p class="outcome" aria-label="Execution result">${
    [
      ...(report.totals.passed
        ? [`${report.totals.passed} ${report.totals.passed === 1 ? "run" : "runs"} passed`]
        : []),
      ...(report.totals.problems
        ? [
            `${report.totals.problems} ${report.totals.problems === 1 ? "run needs" : "runs need"} attention`,
          ]
        : []),
      ...(report.totals.inProgress ? [`${report.totals.inProgress} in progress`] : []),
    ]
      .map(escapeHtml)
      .join(" · ") || "No completed runs"
  }</p>${reviewBlock(report)}
<details class="report-details"><summary>Run details</summary>
${proofBlock(report)}<section class="metrics" aria-label="Result totals"><div class="metric"><strong>${report.totals.runs}</strong><span>Runs</span></div><div class="metric"><strong>${report.totals.screenshots}</strong><span>Screenshots</span></div>${withheldCount > 0 ? `<div class="metric"><strong>${withheldCount}</strong><span>Withheld</span></div>` : ""}<div class="metric"><strong>${report.totals.passed}</strong><span>Passed</span></div><div class="metric"><strong>${report.totals.problems}</strong><span>Need attention</span></div>${report.totals.inProgress > 0 ? `<div class="metric"><strong>${report.totals.inProgress}</strong><span>In progress</span></div>` : ""}</section>
<div class="section-title"><h2>Run summary</h2><span>Structured inputs and device identifiers are omitted</span></div><ul class="runs">${runRows}</ul>
<p class="privacy">Grouped by screen across every run</p>
<p class="privacy"><strong>Privacy:</strong> this capability link includes run summaries and screenshots. Logs, network bodies, structured inputs, and device identifiers are omitted. Screenshots and text labels may contain app content. This link can be revoked. A copy someone already downloaded cannot be recalled.</p>
</details><span class="expires">Available until ${escapeHtml(dateTime(report.share.expiresAt))}</span>
</header><section class="report-gallery" aria-label="Screenshots">
<div class="section-title"><h2>Screenshots</h2><span>Latest first</span></div>${screenSections || '<p class="privacy">No screenshots were captured for this report.</p>'}
</section></div>
</main></body></html>`;
}

async function sharedRuns(record: { runIds: string[] }): Promise<PersistedRun[]> {
  return (await Promise.all(record.runIds.map((id) => readPersistedRun(id)))).filter(
    (run): run is PersistedRun => Boolean(run),
  );
}

/** Minimal tombstone for a capability whose expiry has genuinely passed. No
 * run data, no provenance — just an honest status the recipient can act on. */
function renderExpiredSharePage(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>This proof link has expired</title>
<style>:root{color-scheme:light dark}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f7f7f8;color:#17171b;font-family:Inter,ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;font-synthesis:none}main{max-width:420px;padding:32px;text-align:center}h1{margin:0 0 10px;font-size:22px;letter-spacing:-.02em}p{margin:0;color:#65656f;font-size:14px;line-height:1.5}@media(prefers-color-scheme:dark){body{background:#111114;color:#f4f4f5}p{color:#9a9aa4}}</style>
</head>
<body>
<main>
<h1>This proof link has expired</h1>
<p>The link you followed is past its retention window. Ask the author to share a fresh proof link.</p>
</main>
</body>
</html>`;
}

async function respondWithExpiredTombstone(response: http.ServerResponse): Promise<void> {
  const html = renderExpiredSharePage();
  response.writeHead(410, {
    "Content-Type": "text/html; charset=utf-8",
    "Content-Length": Buffer.byteLength(html),
    "Content-Security-Policy":
      "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    ...PUBLIC_HEADERS,
  });
  response.end(html);
}

export async function handlePublicRunShareRoute(input: {
  method: string;
  pathname: string;
  response: http.ServerResponse;
}): Promise<boolean> {
  if (input.method !== "GET") return false;
  const reportMatch = matchPath(input.pathname, "/shared/runs/:token/report");
  const frameMatch = matchPath(input.pathname, "/shared/runs/:token/frames/:runId/:index");
  const pageMatch = matchPath(input.pathname, "/shared/runs/:token");
  const token = reportMatch?.token ?? frameMatch?.token ?? pageMatch?.token;
  if (!token) return false;
  const resolution = await resolveRunShareTokenState(runsRoot(), token);
  if (resolution.state === "invalid") {
    input.response.writeHead(404, {
      "Content-Type": "text/plain; charset=utf-8",
      ...PUBLIC_HEADERS,
    });
    input.response.end("This Relay report link is invalid, expired, or revoked.");
    return true;
  }
  if (resolution.state === "expired") {
    await respondWithExpiredTombstone(input.response);
    return true;
  }
  const { record } = resolution;
  if (frameMatch) {
    if (!record.runIds.includes(frameMatch.runId!)) {
      input.response.writeHead(404, PUBLIC_HEADERS).end();
      return true;
    }
    const run = await readPersistedRun(frameMatch.runId!);
    const index = Number(frameMatch.index);
    const frame = run && Number.isInteger(index) ? shareableFrames(run)[index] : undefined;
    const buffer = run && frame ? await readFrameFile(run.dir, frame.path) : null;
    if (!run || !frame || !buffer) {
      input.response.writeHead(404, PUBLIC_HEADERS).end();
      return true;
    }
    const actual = createHash("sha256").update(buffer).digest("hex");
    const expected = recordedShareFrameDigests(run, frame.path);
    if (expected.length > 0 && expected.some((digest) => digest !== actual)) {
      input.response.writeHead(409, PUBLIC_HEADERS).end();
      return true;
    }
    input.response.writeHead(200, {
      "Content-Type": "image/png",
      "Content-Length": buffer.byteLength,
      ...PUBLIC_HEADERS,
      ...CORS_HEADERS,
    });
    input.response.end(buffer);
    return true;
  }
  const runs = await sharedRuns(record);
  const blocked = [...(await blockedShareFrameKeys(runs))];
  const report = annotateWithheldFrames(buildRunShareReport(record, runs), blocked);
  if (reportMatch) {
    for (const [name, value] of Object.entries(PUBLIC_HEADERS))
      input.response.setHeader(name, value);
    json(input.response, 200, {
      report,
      notice: "This link can be revoked. A downloaded copy cannot be recalled.",
    });
    return true;
  }
  const html = renderRunShareReportHtml(report, token, blocked);
  input.response.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Content-Length": Buffer.byteLength(html),
    "Content-Security-Policy":
      "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    ...PUBLIC_HEADERS,
  });
  input.response.end(html);
  return true;
}

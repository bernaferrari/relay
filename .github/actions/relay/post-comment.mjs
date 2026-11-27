#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const commentMarker = "<!-- relay-ci-results -->";

export function markerForKey(key) {
  const normalized = String(key || "")
    .trim()
    .replace(/[^A-Za-z0-9._-]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 80);
  return normalized ? `<!-- relay-ci-results:${normalized} -->` : commentMarker;
}

const maximumRows = 40;
const maximumFailureDetails = 5;
const maximumCommentLength = 60_000;

function compactText(value, maximum = 160) {
  const text = String(value ?? "")
    .replace(/\s+/gu, " ")
    .trim();
  return text.length > maximum ? `${text.slice(0, maximum - 1)}…` : text;
}

function truncateText(value, maximum) {
  const text = String(value ?? "").trim();
  return text.length > maximum ? `${text.slice(0, maximum - 1)}…` : text;
}

function markdownText(value, maximum = 160) {
  return compactText(value, maximum)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("|", "\\|")
    .replaceAll("[", "\\[")
    .replaceAll("]", "\\]")
    .replaceAll("*", "\\*")
    .replaceAll("_", "\\_");
}

function codeSpan(value, maximum = 120) {
  const text = compactText(value, maximum);
  const longestTickRun = Math.max(0, ...[...text.matchAll(/`+/gu)].map((match) => match[0].length));
  const fence = "`".repeat(longestTickRun + 1);
  return `${fence}${text}${fence}`;
}

function duration(value) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return "";
  if (value < 1000) return `${Math.round(value)}ms`;
  if (value < 60_000) return `${(value / 1000).toFixed(1)}s`;
  const minutes = Math.floor(value / 60_000);
  return `${minutes}m ${String(Math.round((value % 60_000) / 1000)).padStart(2, "0")}s`;
}

function numberValue(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function outcome(report) {
  const totals = report?.totals || {};
  if (!report || report.kind !== "relay-ci") {
    return { icon: "⚠️", label: "could not run", key: "error" };
  }
  if (numberValue(totals.failed) > 0) return { icon: "❌", label: "failed", key: "failed" };
  if (numberValue(totals.blocked) > 0) return { icon: "⚠️", label: "blocked", key: "blocked" };
  if (numberValue(totals.cancelled) > 0) {
    return { icon: "⏹️", label: "cancelled", key: "cancelled" };
  }
  if (numberValue(totals.pendingReview) > 0) {
    return { icon: "⚠️", label: "needs review", key: "review-required" };
  }
  if (numberValue(totals.passed) > 0) return { icon: "✅", label: "passed", key: "passed" };
  return { icon: "⚠️", label: "blocked", key: "blocked" };
}

function totalsLine(report) {
  const totals = report?.totals || {};
  const parts = [
    `${numberValue(totals.passed)} passed`,
    `${numberValue(totals.failed)} failed`,
    `${numberValue(totals.blocked)} blocked`,
  ];
  if (numberValue(totals.cancelled)) parts.push(`${numberValue(totals.cancelled)} cancelled`);
  if (numberValue(totals.skipped)) parts.push(`${numberValue(totals.skipped)} skipped`);
  if (numberValue(totals.pendingReview)) {
    const pending = numberValue(totals.pendingReview);
    parts.push(`${pending} capture${pending === 1 ? "" : "s"} awaiting review`);
  }
  return parts.join(" · ");
}

const statusIcon = {
  passed: "✅",
  failed: "❌",
  blocked: "⚠️",
  cancelled: "⏹️",
  running: "⏳",
  skipped: "⏭️",
};

const statusRank = {
  failed: 0,
  blocked: 1,
  cancelled: 2,
  running: 3,
  passed: 4,
  skipped: 5,
};

function tableRows(report) {
  const verdicts = Array.isArray(report?.verdicts) ? report.verdicts : [];
  const skipped = Array.isArray(report?.skipped) ? report.skipped : [];
  return [
    ...verdicts.map((verdict, index) => ({
      status: typeof verdict?.status === "string" ? verdict.status : "blocked",
      title: verdict?.title || "Untitled Test",
      summary: [verdict?.summary, duration(verdict?.durationMs)].filter(Boolean).join(" · "),
      index,
    })),
    ...skipped.map((skip, index) => ({
      status: "skipped",
      title: skip?.name || "Skipped Test",
      summary: skip?.reason || "not ready",
      index: verdicts.length + index,
    })),
  ].sort((a, b) => (statusRank[a.status] ?? 9) - (statusRank[b.status] ?? 9) || a.index - b.index);
}

function evidenceByRunId(evidenceEntries) {
  const map = new Map();
  for (const entry of Array.isArray(evidenceEntries) ? evidenceEntries : []) {
    if (entry?.runId) map.set(entry.runId, entry);
  }
  return map;
}

function failureDetails(report, evidenceEntries) {
  const verdicts = Array.isArray(report?.verdicts) ? report.verdicts : [];
  const failures = verdicts.filter((verdict) =>
    ["failed", "blocked", "cancelled"].includes(verdict?.status),
  );
  if (!failures.length) return [];

  const evidence = evidenceByRunId(evidenceEntries);
  const lines = [`<details><summary>Failure details (${failures.length})</summary>`, ""];
  for (const verdict of failures.slice(0, maximumFailureDetails)) {
    const steps = Array.isArray(verdict?.steps) ? verdict.steps : [];
    const failedIndex = steps.findIndex((step) => step?.status === "failed");
    const failedStep = failedIndex >= 0 ? steps[failedIndex] : undefined;
    lines.push(`**${markdownText(verdict?.title || "Untitled Test", 120)}**`);
    if (failedStep) {
      lines.push(`- **Step ${failedIndex + 1}:** ${markdownText(failedStep.title, 180)}`);
      if (failedStep.expected) {
        lines.push(`- **Expected:** ${markdownText(failedStep.expected, 260)}`);
      }
      if (failedStep.saw) lines.push(`- **Saw:** ${markdownText(failedStep.saw, 260)}`);
    } else {
      const reason = verdict?.reason || verdict?.summary;
      if (reason) lines.push(`- **Why:** ${markdownText(reason, 300)}`);
    }
    if (verdict?.runId) {
      const exported = evidence.get(verdict.runId);
      const evidenceText = exported?.exported ? ` · evidence at \`${exported.path}/\`` : "";
      lines.push(`- **Run:** ${codeSpan(verdict.runId, 100)}${evidenceText}`);
    }
    lines.push("");
  }
  if (failures.length > maximumFailureDetails) {
    lines.push(`…and ${failures.length - maximumFailureDetails} more in the artifact.`, "");
  }
  lines.push("</details>");
  return lines;
}

function artifactDetails(artifactUrl, runUrl, evidenceEntries) {
  const exported = (Array.isArray(evidenceEntries) ? evidenceEntries : []).filter(
    (entry) => entry?.exported,
  ).length;
  const lines = ["<details><summary>Artifacts and evidence</summary>", ""];
  if (artifactUrl) {
    lines.push(
      `[Download the Relay artifact](${artifactUrl}). It contains runner diagnostics plus whatever Relay produced:`,
    );
  } else {
    lines.push(
      `[Artifact upload was unavailable; open the workflow run](${runUrl}). When uploaded, the artifact contains:`,
    );
  }
  lines.push(
    "",
    "- `results.json` — machine-readable verdicts",
    "- `junit.xml` — JUnit XML for CI dashboards",
    `- \`evidence/<run>/trace-pack.json\` and \`evidence/<run>/walkthrough.html\` — exported for ${exported} run${exported === 1 ? "" : "s"}`,
    "- `relay-cli.log` and `action-metadata.json` — runner diagnostics",
    "",
    "</details>",
  );
  return lines;
}

function fenced(text) {
  const runs = [...String(text).matchAll(/`+/gu)].map((match) => match[0].length);
  const fence = "`".repeat(Math.max(3, ...runs.map((length) => length + 1)));
  return `${fence}text\n${String(text).trim()}\n${fence}`;
}

function boundedComment(body) {
  if (body.length <= maximumCommentLength) return body;
  return `${body.slice(0, maximumCommentLength - 200)}\n\n…comment truncated; see the artifact for the full results.\n`;
}

/**
 * Render the sticky pull-request comment. Keep this compact: one table, worst
 * results first, and details hidden behind disclosure blocks.
 */
export function renderComment(input) {
  const report = input.report;
  const result = outcome(report);
  const marker = input.commentMarker || commentMarker;
  const lines = [marker, `## Relay: ${result.icon} ${result.label}`, ""];

  if (report?.kind === "relay-ci") {
    const appName = report.app?.name ? ` for **${markdownText(report.app.name, 80)}**` : "";
    lines.push(`${totalsLine(report)}${appName}`);
  } else {
    const exitText = input.exitCode ? ` (exit ${markdownText(input.exitCode, 20)})` : "";
    lines.push(
      `Relay did not write a readable \`results.json\`${exitText}. The job log has the failure.`,
    );
  }

  const links = [];
  if (input.runUrl) links.push(`[workflow run](${input.runUrl})`);
  if (input.artifactUrl) links.push(`[artifacts](${input.artifactUrl})`);
  if (links.length) lines.push("", links.join(" · "));

  if (report?.kind === "relay-ci") {
    const rows = tableRows(report);
    if (rows.length) {
      lines.push("", "| Result | Test | Summary |", "|---|---|---|");
      for (const row of rows.slice(0, maximumRows)) {
        lines.push(
          `| ${statusIcon[row.status] || "⚠️"} ${row.status} | ${markdownText(row.title, 120)} | ${markdownText(row.summary, 180)} |`,
        );
      }
      if (rows.length > maximumRows) {
        lines.push(`| … | ${rows.length - maximumRows} more results | See the artifact |`);
      }
    }
    lines.push("", ...failureDetails(report, input.evidenceEntries));
  }

  if (input.errorText) {
    lines.push(
      "",
      "<details><summary>Runner diagnostics</summary>",
      "",
      fenced(truncateText(input.errorText, 2_500)),
      "",
      "</details>",
    );
  }

  lines.push("", ...artifactDetails(input.artifactUrl, input.runUrl, input.evidenceEntries));
  return `${boundedComment(lines.filter((line) => line !== undefined).join("\n"))}\n`;
}

async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return undefined;
  }
}

async function readText(path) {
  try {
    return await readFile(path, "utf8");
  } catch {
    return "";
  }
}

function commandEscape(message) {
  return String(message).replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A");
}

function warning(message) {
  console.log(`::warning::${commandEscape(message)}`);
}

async function apiRequest(apiUrl, token, method, path, body) {
  const base = String(apiUrl).replace(/\/+$/u, "");
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "user-agent": "relay-github-action",
      "x-github-api-version": "2022-11-28",
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!response.ok) {
    const detail = compactText(await response.text().catch(() => ""), 500);
    throw new Error(`GitHub API ${method} ${path} failed with ${response.status}: ${detail}`);
  }
  if (response.status === 204) return undefined;
  return response.json();
}

async function upsertComment({ apiUrl, token, owner, repo, issueNumber, body, marker }) {
  const base = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
  let existing;
  for (let page = 1; page <= 5 && !existing; page += 1) {
    const comments = await apiRequest(
      apiUrl,
      token,
      "GET",
      `${base}/issues/${issueNumber}/comments?per_page=100&page=${page}`,
    );
    if (Array.isArray(comments)) {
      existing = comments.find(
        (comment) => typeof comment?.body === "string" && comment.body.includes(marker),
      );
      if (comments.length < 100) break;
    } else {
      break;
    }
  }

  if (existing?.id) {
    await apiRequest(apiUrl, token, "PATCH", `${base}/issues/comments/${existing.id}`, { body });
    return "updated";
  }
  await apiRequest(apiUrl, token, "POST", `${base}/issues/${issueNumber}/comments`, { body });
  return "created";
}

function pullRequestNumber(payload) {
  if (Number.isSafeInteger(payload?.pull_request?.number)) return payload.pull_request.number;
  if (payload?.issue?.pull_request && Number.isSafeInteger(payload.issue.number)) {
    return payload.issue.number;
  }
  return undefined;
}

async function main() {
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!eventPath) {
    console.log("Relay comment skipped: GITHUB_EVENT_PATH is not set.");
    return;
  }
  const payload = await readJson(eventPath);
  const issueNumber = pullRequestNumber(payload);
  if (!issueNumber) {
    console.log("Relay comment skipped: this is not a pull-request event.");
    return;
  }
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    warning("Relay could not comment because GITHUB_TOKEN is empty.");
    return;
  }
  const [owner, repo] = String(process.env.GITHUB_REPOSITORY || "").split("/");
  if (!owner || !repo) {
    warning("Relay could not comment because GITHUB_REPOSITORY is missing or malformed.");
    return;
  }

  const workspace = resolve(process.env.GITHUB_WORKSPACE || process.cwd());
  const resultsFile = resolve(
    workspace,
    process.env.RELAY_RESULTS_FILE || ".relay-ci/results.json",
  );
  const errorFile = resolve(
    workspace,
    process.env.RELAY_ERROR_FILE || ".relay-ci/action-error.txt",
  );
  const evidenceManifestFile = resolve(
    workspace,
    process.env.RELAY_EVIDENCE_MANIFEST || ".relay-ci/evidence-manifest.json",
  );
  const serverUrl = process.env.GITHUB_SERVER_URL || "https://github.com";
  const apiUrl = process.env.GITHUB_API_URL || "https://api.github.com";
  const repository = process.env.GITHUB_REPOSITORY;
  const runId = process.env.GITHUB_RUN_ID;
  const runUrl = runId ? `${serverUrl}/${repository}/actions/runs/${runId}` : "";
  const artifactUrl = compactText(process.env.RELAY_ARTIFACT_URL || "", 1_000);
  const marker = markerForKey(process.env.RELAY_COMMENT_KEY || "");

  const body = renderComment({
    report: await readJson(resultsFile),
    evidenceEntries: await readJson(evidenceManifestFile),
    errorText: await readText(errorFile),
    artifactUrl,
    runUrl,
    exitCode: process.env.RELAY_EXIT_CODE || "",
    commentMarker: marker,
  });

  const state = await upsertComment({
    apiUrl,
    token,
    owner,
    repo,
    issueNumber,
    body,
    marker,
  });
  console.log(`Relay pull-request comment ${state}.`);
}

const entrypoint = process.argv[1] ? resolve(process.argv[1]) : "";
if (entrypoint === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    // A missing comment must never hide the Relay verdict. The final action
    // step still exits with the CLI's original code.
    warning(`Relay could not create or update the pull-request comment: ${error.message || error}`);
  });
}

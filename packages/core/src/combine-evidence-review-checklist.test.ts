import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { CombineEvidenceFinding } from "@relay/protocol";
import {
  applyReviewChecklistTodosToPack,
  classifyReviewChecklistStatus,
  embedReviewChecklist,
  mergeReviewChecklistTodos,
  parseReviewChecklistTodoFile,
  readVisualComparisonIdsByRunId,
  reviewChecklistRows,
  reviewChecklistSection,
  visualReviewCommand,
  writeReviewChecklistFiles,
} from "./combine-evidence-review-checklist.js";

function finding(jobId: string, code: CombineEvidenceFinding["code"]): CombineEvidenceFinding {
  return {
    id: `${code.toLowerCase()}-${jobId}`,
    code,
    severity: "critical",
    confidence: "high",
    canonicalKey: `job:${jobId}`,
    screenLabel: jobId,
    locale: "en",
    baselineLocale: "en",
    detail: "typed finding",
  };
}

test("JUDGE_UNCERTAIN stays pending review and does not accept a baseline", () => {
  assert.equal(
    classifyReviewChecklistStatus({ status: "error", findingCode: "JUDGE_UNCERTAIN" }),
    "pending review",
  );
});

test("PRODUCT_ASSERTION is check failed, not classified from error prose", () => {
  assert.equal(
    classifyReviewChecklistStatus({ status: "error", findingCode: "PRODUCT_ASSERTION" }),
    "check failed",
  );
  assert.equal(classifyReviewChecklistStatus({ status: "error" }), "could not run");
  assert.equal(
    classifyReviewChecklistStatus({
      status: "failed",
      findingCode: "POSSIBLE_UNTRANSLATED_TEXT",
    }),
    "could not run",
  );
});

test("HARNESS_FAILURE is could not run", () => {
  assert.equal(
    classifyReviewChecklistStatus({ status: "cancelled", findingCode: "HARNESS_FAILURE" }),
    "could not run",
  );
  assert.equal(
    classifyReviewChecklistStatus({ status: "error", findingCode: "HARNESS_FAILURE" }),
    "could not run",
  );
});

test("manual cancellation stays cancelled, not could not run", () => {
  assert.equal(classifyReviewChecklistStatus({ status: "cancelled" }), "cancelled");
  assert.equal(
    classifyReviewChecklistStatus({ status: "cancelled", findingCode: "USER_CANCELLED" }),
    "cancelled",
  );
});

test("ok capture-review work stays pending review instead of passed", () => {
  assert.equal(
    classifyReviewChecklistStatus({ status: "ok", captureReviewPending: true }),
    "pending review",
  );
  assert.equal(classifyReviewChecklistStatus({ status: "ok" }), "passed");
});

test("ok or healed without a job finding is passed", () => {
  assert.equal(classifyReviewChecklistStatus({ status: "ok" }), "passed");
  assert.equal(classifyReviewChecklistStatus({ status: "healed" }), "passed");
  assert.equal(classifyReviewChecklistStatus({ status: "passed" }), "passed");
});

test("blocked and relogin findings are could not run", () => {
  assert.equal(
    classifyReviewChecklistStatus({ status: "blocked", findingCode: "BLOCKED" }),
    "could not run",
  );
  assert.equal(
    classifyReviewChecklistStatus({
      status: "error",
      findingCode: "ACCOUNT_NEEDS_RELOGIN",
    }),
    "could not run",
  );
});

test("checklist rows use job canonical findings and ignore locale codes", () => {
  const rows = reviewChecklistRows({
    cases: [
      {
        jobId: "job-home",
        name: "Open grok.com logged-out",
        status: "ok",
        frames: ["en/screenshots/001.png", "en/screenshots/002.png", "en/screenshots/full.png"],
      },
      {
        jobId: "job-send",
        name: "Send hello",
        status: "error",
        frames: ["logged-out/screenshots/001.png"],
      },
      {
        jobId: "job-toolbar",
        name: "Toolbar on existing chat",
        status: "cancelled",
        frames: [],
      },
    ],
    findings: [
      {
        id: "untranslated",
        code: "POSSIBLE_UNTRANSLATED_TEXT",
        severity: "warning",
        confidence: "medium",
        canonicalKey: "frame-001",
        screenLabel: "Home",
        locale: "pt-BR",
        baselineLocale: "en",
        detail: "same English copy",
      },
      finding("job-send", "PRODUCT_ASSERTION"),
      finding("job-toolbar", "HARNESS_FAILURE"),
    ],
    visualComparisonByJobId: { "job-home": "visual-comparison-abc" },
  });
  assert.equal(rows[0]?.findingCode, undefined);
  assert.equal(rows[1]?.findingCode, "PRODUCT_ASSERTION");
  assert.equal(rows[2]?.findingCode, "HARNESS_FAILURE");
  assert.deepEqual(
    rows.map((row) => [row.test, row.status, row.visualComparisonId, row.reviewCommand]),
    [
      [
        "Open grok.com logged-out",
        "passed",
        "visual-comparison-abc",
        "relay run visual review job-home",
      ],
      ["Send hello", "check failed", undefined, "relay run visual review job-send"],
      [
        "Toolbar on existing chat",
        "could not run",
        undefined,
        "relay run visual review job-toolbar",
      ],
    ],
  );
  assert.equal(rows[0]?.beforePng, "en/screenshots/001.png");
  assert.equal(rows[0]?.afterPng, "en/screenshots/002.png");
  assert.equal(rows[1]?.beforePng, "logged-out/screenshots/001.png");
  assert.equal(rows[1]?.afterPng, "logged-out/screenshots/001.png");
});

test("todo file items merge as unbound todo rows", () => {
  const rows = mergeReviewChecklistTodos(
    [
      {
        id: "job-home",
        test: "Open grok.com logged-out",
        status: "passed",
        jobId: "job-home",
      },
    ],
    [
      { id: "chat-heavy", title: "Chat Heavy", note: "Needs Heavy Lane" },
      { id: "sso", title: "Google / Apple / X / Email login" },
      { id: "job-home", title: "already ran" },
    ],
  );
  assert.equal(rows.length, 3);
  assert.equal(rows[1]?.status, "todo");
  assert.equal(rows[1]?.test, "Chat Heavy");
  assert.equal(rows[1]?.note, "Needs Heavy Lane");
  assert.equal(rows[2]?.test, "Google / Apple / X / Email login");
  assert.equal(
    rows.some((row) => row.test === "already ran"),
    false,
  );
});

test("todo JSON and unchecked markdown parse as gated rows", () => {
  assert.deepEqual(
    parseReviewChecklistTodoFile(
      JSON.stringify({
        items: [{ id: "chat-heavy", title: "Chat Heavy", note: "Gated" }],
      }),
    ),
    [{ id: "chat-heavy", title: "Chat Heavy", note: "Gated" }],
  );
  assert.deepEqual(parseReviewChecklistTodoFile('["SSO"]'), [{ id: "sso", title: "SSO" }]);
  assert.deepEqual(
    parseReviewChecklistTodoFile(
      ["# leftovers", "- [x] Chat Build (done)", "- [ ] Chat Heavy", "- [ ] SSO"].join("\n"),
    ),
    [
      { id: "chat-heavy", title: "Chat Heavy" },
      { id: "sso", title: "SSO" },
    ],
  );
  assert.throws(() => parseReviewChecklistTodoFile('{"no":"items"}'), /JSON array or \{ items/);
});

test("checklist HTML links the human visual review command only", () => {
  const html = reviewChecklistSection([
    {
      id: "job-home",
      test: "Open grok.com logged-out",
      status: "passed",
      jobId: "job-home",
      beforePng: "en/before.png",
      afterPng: "en/after.png",
      visualComparisonId: "visual-comparison-abc",
      reviewCommand: visualReviewCommand("job-home"),
    },
    { id: "chat-heavy", test: "Chat Heavy", status: "todo", note: "Gated" },
  ]);
  assert.match(html, /relay run visual review job-home/);
  assert.match(html, /visual-comparison-abc/);
  assert.match(html, /never accept a visual baseline/);
  assert.match(html, /data-status="passed"/);
  assert.match(html, /data-status="todo"/);
  assert.doesNotMatch(html, /approve-new-baseline/);
  assert.doesNotMatch(html, /relay run approve/);
});

test("embed replaces an existing checklist section", () => {
  const first = embedReviewChecklist("<main><p>cases</p></main>", [
    { id: "a", test: "A", status: "passed", reviewCommand: visualReviewCommand("a") },
  ]);
  const second = embedReviewChecklist(first, [
    { id: "b", test: "B", status: "check failed", reviewCommand: visualReviewCommand("b") },
  ]);
  assert.match(second, /relay run visual review b/);
  assert.doesNotMatch(second, /relay run visual review a/);
});

test("pack files persist rows so --todo can merge later", async () => {
  const directory = await mkdtemp(join(tmpdir(), "relay-checklist-pack-"));
  try {
    const html = await writeReviewChecklistFiles(directory, "<main></main>", [
      {
        id: "job-home",
        test: "Home",
        status: "passed",
        jobId: "job-home",
        reviewCommand: visualReviewCommand("job-home"),
      },
    ]);
    await writeFile(join(directory, "index.html"), html, "utf8");
    const rows = await applyReviewChecklistTodosToPack(directory, [
      { id: "chat-heavy", title: "Chat Heavy" },
    ]);
    assert.equal(rows.length, 2);
    const written = await readFile(join(directory, "index.html"), "utf8");
    assert.match(written, /Chat Heavy/);
    assert.match(written, /data-status="todo"/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("latest visual-comparison id is keyed by run id", async () => {
  const directory = await mkdtemp(join(tmpdir(), "relay-checklist-compare-"));
  try {
    await mkdir(directory, { recursive: true });
    await writeFile(
      join(directory, ".visual-comparisons.json"),
      JSON.stringify([
        { id: "visual-comparison-old", latest: { runId: "job-home" }, comparedAt: 1 },
        { id: "visual-comparison-new", latest: { runId: "job-home" }, comparedAt: 2 },
        { id: "visual-comparison-other", latest: { runId: "job-other" }, comparedAt: 9 },
      ]),
    );
    const ids = await readVisualComparisonIdsByRunId(directory);
    assert.equal(ids.get("job-home"), "visual-comparison-new");
    assert.equal(ids.get("job-other"), "visual-comparison-other");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import type { CorpusControl, CorpusFinding, CorpusScreen, CorpusSession } from "@relay/protocol";
import { analyzeCorpus } from "./corpus-report.js";
import {
  forgetKnownLocaleFinding,
  listKnownLocaleFindings,
  markLocaleFindingKnown,
} from "./locale-finding-triage.js";

const roots: string[] = [];

afterEach(async () => {
  delete process.env.RELAY_WORKSPACE_ROOT;
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function workspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "relay-known-findings-"));
  roots.push(root);
  process.env.RELAY_WORKSPACE_ROOT = root;
  return root;
}

function control(label: string): CorpusControl {
  // Same box in both languages: geometry is half of the clipped-text signal.
  return {
    id: `c-${label}`,
    label,
    stableKey: "structure:row[0]",
    target: {},
    rect: { x: 0, y: 120, width: 180, height: 44 },
  };
}

function screen(input: { id: string; locale: string; label: string }): CorpusScreen {
  return {
    id: input.id,
    canonicalKey: "settings",
    fingerprint: `fp-${input.locale}`,
    locale: input.locale,
    depth: 1,
    path: ["Settings"],
    pathKeys: ["settings"],
    title: "Settings",
    capturedAt: 1,
    controls: [control(input.label)],
    localizedLabels: { "structure:row[0]": input.label },
  };
}

/** Two sweeps of the same screens, run on different days. */
function sweep(id: string): CorpusSession {
  const now = Date.now();
  return {
    id,
    name: id,
    targetId: "ipad",
    scope: {
      maxDepth: 2,
      maxScreens: 10,
      maxTransitions: 20,
      maxDurationMs: 1000,
      locales: ["en", "de"],
      mapLocale: "en",
    },
    status: "complete",
    createdAt: now,
    updatedAt: now,
    progress: { phase: "complete", screensCaptured: 2, transitionsCaptured: 0, updatedAt: now },
    screens: [
      screen({ id: `${id}-en`, locale: "en", label: "Appearance" }),
      // German label, same box, materially longer: the clipped-text heuristic.
      screen({ id: `${id}-de`, locale: "de", label: "Erscheinungsbild und Anzeige" }),
    ],
    transitions: [],
  };
}

function clipped(session: CorpusSession): CorpusFinding {
  const finding = analyzeCorpus(session).findings.find((item) => item.locale === "de");
  assert.ok(finding, "expected a German finding to accept");
  return finding;
}

test("the same defect keeps its identity across sweeps, so accepting it sticks", () => {
  // This is the whole reason a set of ids is enough: the analyzer derives the id
  // from the code, the screen, the language and the control — never from the
  // sweep it happened to be seen on.
  assert.equal(clipped(sweep("sweep-monday")).id, clipped(sweep("sweep-friday")).id);
});

test("an accepted finding survives, and re-accepting it does not duplicate the row", async () => {
  await workspace();
  const finding = clipped(sweep("sweep-monday"));
  await markLocaleFindingKnown({ finding, note: "Design signed this off" });
  await markLocaleFindingKnown({ finding: clipped(sweep("sweep-friday")) });

  const known = await listKnownLocaleFindings();
  assert.equal(known.length, 1);
  assert.equal(known[0]!.id, finding.id);
  assert.equal(known[0]!.locale, "de");
  assert.equal(known[0]!.screenLabel, "Settings");
  // The second accept is the newer truth, so the stale note does not linger.
  assert.equal(known[0]!.note, undefined);
});

test("a finding can be put back in the queue, and an unknown id is not an error", async () => {
  await workspace();
  const finding = clipped(sweep("sweep-monday"));
  await markLocaleFindingKnown({ finding });
  assert.deepEqual(await forgetKnownLocaleFinding(finding.id), []);
  assert.deepEqual(await forgetKnownLocaleFinding("never-existed"), []);
});

test("a workspace nobody has triaged reports nothing rather than failing", async () => {
  await workspace();
  assert.deepEqual(await listKnownLocaleFindings(), []);
});

test("a finding without an id cannot be accepted", async () => {
  await workspace();
  await assert.rejects(
    () => markLocaleFindingKnown({ finding: { ...clipped(sweep("s")), id: "  " } }),
    /finding id is required/,
  );
});

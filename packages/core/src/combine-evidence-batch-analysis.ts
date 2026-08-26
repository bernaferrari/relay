/**
 * Findings for a Combine, from the pack's own evidence.
 *
 * A language Variable Combine replays one authored Test per value, so the nth authored
 * screenshot of every case is the same screen in a different language. That
 * ordinal is the locale-stable identity a crawl gets from the tree, which
 * makes the pack readable by the same analyzer instead of a second one.
 */
import type { CombineEvidenceAnalysis, CombineEvidencePackFrame } from "@relay/protocol";
import { analyzeCombineEvidence } from "./combine-evidence-analysis.js";
import type { CombineEvidenceScreen, CombineEvidenceSession } from "./combine-evidence-session.js";
import { combineEvidenceControls } from "./combine-evidence-screen-analysis.js";
import type { SnapshotNode } from "./device.js";
import type { FrameObservation } from "./frame-observation.js";

export type CombineEvidenceCapture = {
  locale: string;
  jobId: string;
  /** Position of this authored screenshot inside its own case. */
  index: number;
  /** Pack-relative PNG path. */
  packPath: string;
  /** Digest of the PNG: two identical rasters mean the locale never applied. */
  sha256?: string;
  observation?: FrameObservation;
  /** Raw snapshot nodes. Frame-observation control lists are not a tree. */
  nodes?: SnapshotNode[];
};

export type CombineEvidencePackAnalysis = {
  analysis: CombineEvidenceAnalysis;
  byCanonicalKey: Record<string, Record<string, string>>;
  frames: CombineEvidencePackFrame[];
  coverage: { frames: number; inspectedFrames: number };
};

export function combineEvidenceCanonicalKey(index: number): string {
  return `frame-${String(index + 1).padStart(3, "0")}`;
}

function screenFor(capture: CombineEvidenceCapture, compareText: boolean): CombineEvidenceScreen {
  const canonicalKey = combineEvidenceCanonicalKey(capture.index);
  const observation = capture.observation;
  const caption = observation?.caption?.trim();
  const title = observation?.title?.trim() || caption || `Screenshot ${capture.index + 1}`;
  // Combine cases differ by state, not by language. Comparing their copy would
  // report every intended difference as a translation defect, so those packs
  // keep the frames and lose the labels: presence is all that is comparable.
  const controls = compareText
    ? capture.nodes?.length
      ? combineEvidenceControls(capture.nodes)
      : (observation?.controls ?? [])
    : [];
  return {
    id: `${capture.jobId}:${canonicalKey}`,
    canonicalKey,
    // Without a tree and without a digest there is nothing to compare, so the
    // frame stands for itself rather than colliding with its neighbours.
    fingerprint: observation?.fingerprint ?? capture.sha256 ?? capture.packPath,
    locale: capture.locale,
    depth: capture.index,
    path: [title],
    pathKeys: [canonicalKey],
    title,
    capturedAt: 0,
    screenshotPath: capture.packPath,
    ...(capture.sha256 ? { snapshotDigest: capture.sha256 } : {}),
    ...(controls.length
      ? {
          controls,
          localizedLabels: Object.fromEntries(
            controls.map((control) => [control.stableKey, control.label]),
          ),
        }
      : {}),
  };
}

function sessionFor(input: {
  batchId: string;
  title: string;
  locales: string[];
  screens: CombineEvidenceScreen[];
}): CombineEvidenceSession {
  const now = Date.now();
  return {
    id: input.batchId,
    name: input.title,
    targetId: "",
    scope: {
      locales: input.locales,
      ...(input.locales[0] ? { mapLocale: input.locales[0] } : {}),
    },
    status: "complete",
    createdAt: now,
    updatedAt: now,
    screens: input.screens,
  };
}

/**
 * The pack's cases read as one comparable session: one screen per authored
 * frame per locale, analyzed by the same deterministic checks the language
 * sweep uses. A single locale has no baseline to differ from, so it reports
 * nothing.
 */
export function analyzeCombineEvidenceBatchData(input: {
  batchId: string;
  title: string;
  locales: string[];
  captures: CombineEvidenceCapture[];
  compareText: boolean;
}): CombineEvidencePackAnalysis {
  const screens = input.captures.map((capture) => screenFor(capture, input.compareText));
  const session = sessionFor({
    batchId: input.batchId,
    title: input.title,
    locales: input.locales,
    screens,
  });

  const byCanonicalKey: Record<string, Record<string, string>> = {};
  const frames: CombineEvidencePackFrame[] = [];
  for (const capture of input.captures) {
    const canonicalKey = combineEvidenceCanonicalKey(capture.index);
    const locales = byCanonicalKey[canonicalKey] ?? {};
    locales[capture.locale] = capture.packPath;
    byCanonicalKey[canonicalKey] = locales;
    const caption = capture.observation?.caption?.trim();
    frames.push({
      path: capture.packPath,
      canonicalKey,
      ...(caption ? { caption } : {}),
      inspected: Boolean(capture.nodes?.length || capture.observation?.controls.length),
    });
  }

  return {
    analysis: analyzeCombineEvidence(session),
    byCanonicalKey,
    frames,
    coverage: {
      frames: frames.length,
      inspectedFrames: frames.filter((frame) => frame.inspected).length,
    },
  };
}

/**
 * Findings for a locale matrix, from the pack's own evidence.
 *
 * A matrix replays one authored test per locale, so the nth authored
 * screenshot of every case is the same screen in a different language. That
 * ordinal is the locale-stable identity a crawl gets from the tree, which
 * makes the pack readable by the corpus analyzer instead of a second one.
 */
import type {
  CorpusAnalysisReport,
  CorpusScreen,
  CorpusSession,
  LocaleRunPackFrame,
} from "@relay/protocol";
import { analyzeCorpus } from "./corpus-report.js";
import { corpusControls } from "./corpus-screen-analysis.js";
import type { SnapshotNode } from "./device.js";
import type { FrameObservation } from "./frame-observation.js";

export type LocaleRunPackCapture = {
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

export type LocaleRunPackAnalysis = {
  analysis: CorpusAnalysisReport;
  byCanonicalKey: Record<string, Record<string, string>>;
  frames: LocaleRunPackFrame[];
  coverage: { frames: number; inspectedFrames: number };
};

export function localeRunCanonicalKey(index: number): string {
  return `frame-${String(index + 1).padStart(3, "0")}`;
}

function screenFor(capture: LocaleRunPackCapture, compareText: boolean): CorpusScreen {
  const canonicalKey = localeRunCanonicalKey(capture.index);
  const observation = capture.observation;
  const caption = observation?.caption?.trim();
  const title = observation?.title?.trim() || caption || `Screenshot ${capture.index + 1}`;
  // Combine cases differ by state, not by language. Comparing their copy would
  // report every intended difference as a translation defect, so those packs
  // keep the frames and lose the labels: presence is all that is comparable.
  const controls = compareText
    ? capture.nodes?.length
      ? corpusControls(capture.nodes)
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

/**
 * The pack's cases read as a corpus: one screen per authored frame per locale,
 * analyzed by the same deterministic checks the language sweep uses. A single
 * locale has no baseline to differ from, so it reports nothing.
 */
export function analyzeLocaleRunPack(input: {
  batchId: string;
  title: string;
  locales: string[];
  captures: LocaleRunPackCapture[];
  compareText: boolean;
}): LocaleRunPackAnalysis {
  const screens = input.captures.map((capture) => screenFor(capture, input.compareText));
  const now = Date.now();
  const session: CorpusSession = {
    id: input.batchId,
    name: input.title,
    targetId: "",
    scope: {
      maxDepth: 0,
      maxScreens: screens.length,
      maxTransitions: 0,
      maxDurationMs: 0,
      locales: input.locales,
      ...(input.locales[0] ? { mapLocale: input.locales[0] } : {}),
    },
    status: "complete",
    createdAt: now,
    updatedAt: now,
    progress: {
      phase: "complete",
      screensCaptured: screens.length,
      transitionsCaptured: 0,
      completedLocales: input.locales,
      updatedAt: now,
    },
    screens,
    transitions: [],
  };

  const byCanonicalKey: Record<string, Record<string, string>> = {};
  const frames: LocaleRunPackFrame[] = [];
  for (const capture of input.captures) {
    const canonicalKey = localeRunCanonicalKey(capture.index);
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
    analysis: analyzeCorpus(session),
    byCanonicalKey,
    frames,
    coverage: {
      frames: frames.length,
      inspectedFrames: frames.filter((frame) => frame.inspected).length,
    },
  };
}

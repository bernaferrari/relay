/**
 * The pack a locale matrix (or a combine run) exports.
 *
 * A pack used to be a screenshot gallery. It now carries the same findings the
 * corpus sweep produces, computed from its own frames and the trees captured
 * beside them, so the grid a person clicks can say what broke.
 */
import type { CorpusAnalysisReport } from "./corpus-contract.js";

/** One authored screenshot inside a matrix case. */
export type LocaleRunPackFrame = {
  /** Pack-relative PNG path. */
  path: string;
  /** Identity shared with the same authored capture in every other case. */
  canonicalKey: string;
  caption?: string;
  /** A UI tree was captured beside this frame, so its text can be compared. */
  inspected: boolean;
};

export type LocaleRunPackCase = {
  locale: string;
  jobId: string;
  status: string;
  name: string;
  frames: string[];
  expectedFrames?: number;
  captures?: LocaleRunPackFrame[];
};

/** One authored screenshot of a batch that has not been exported yet. */
export type LocaleRunCaseFrame = {
  /** Run-relative frame path, e.g. frames/003.png. */
  framePath: string;
  /** Identity shared with the same authored capture in every other case. */
  canonicalKey: string;
  caption?: string;
  inspected: boolean;
};

/**
 * Findings for a live batch, read without writing a pack.
 *
 * The grid needs the verdict of every cell while the sweep is still on screen,
 * and exporting forty locales of screenshots to answer that would be a strange
 * price for a hover. Same analyzer, same codes, frames named where they live.
 */
export type LocaleRunAnalysisReport = {
  schemaVersion: 1;
  batchId: string;
  locales: string[];
  analysis: CorpusAnalysisReport;
  coverage: { frames: number; inspectedFrames: number };
  cases: Array<{
    jobId: string;
    locale: string;
    status: string;
    frames: LocaleRunCaseFrame[];
  }>;
};

export type LocaleRunPackManifest = {
  schemaVersion: 2;
  batchId: string;
  recipeId: string;
  title: string;
  generatedAt: number;
  locales: string[];
  cases: LocaleRunPackCase[];
  /** canonicalKey → locale → pack-relative PNG, so a finding can be shown beside the frame it came from. */
  byCanonicalKey: Record<string, Record<string, string>>;
  /** Shared corpus finding codes over this pack's evidence. */
  analysis: CorpusAnalysisReport;
  /**
   * Text findings need a captured tree. Frames without one are still compared
   * for presence, so a pack states how much of it could be read.
   */
  analysisCoverage: { frames: number; inspectedFrames: number };
};

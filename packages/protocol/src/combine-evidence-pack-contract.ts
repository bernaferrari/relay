/** A portable review pack exported from one Combine run. */
import type { CombineEvidenceAnalysis } from "./combine-evidence-contract.js";

/** One authored screenshot inside a Combine case. */
export type CombineEvidencePackFrame = {
  /** Pack-relative PNG path. */
  path: string;
  /** Identity shared with the same authored capture in every other case. */
  canonicalKey: string;
  caption?: string;
  /** A UI tree was captured beside this frame, so its text can be compared. */
  inspected: boolean;
};

export type CombineEvidencePackCase = {
  locale: string;
  jobId: string;
  status: string;
  name: string;
  frames: string[];
  expectedFrames?: number;
  captures?: CombineEvidencePackFrame[];
};

/** One authored screenshot of a batch that has not been exported yet. */
export type CombineEvidenceCaseFrame = {
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
 * The grid needs the verdict of every cell while the Combine is still on screen,
 * and exporting forty locales of screenshots to answer that would be a strange
 * price for a hover. Same analyzer, same codes, frames named where they live.
 */
export type CombineEvidenceAnalysisReport = {
  schemaVersion: 1;
  batchId: string;
  locales: string[];
  analysis: CombineEvidenceAnalysis;
  coverage: { frames: number; inspectedFrames: number };
  cases: Array<{
    jobId: string;
    locale: string;
    status: string;
    frames: CombineEvidenceCaseFrame[];
  }>;
};

export type CombineEvidencePackManifest = {
  /** Content equality does not certify translation quality. Missing trees are excluded. */
  content?: {
    method: "ordered-nfc-text-v1";
    inspectedPages: number;
    uniquePages: number;
    duplicateGroups: string[][];
    pages: Array<{
      path: string;
      jobId: string;
      locale: string;
      canonicalKey: string;
      screenshotSha256?: string;
      textSha256?: string;
      text?: string;
      textPath?: string;
      accessibilityPath?: string;
    }>;
  };
  schemaVersion: 2;
  batchId: string;
  recipeId: string;
  title: string;
  generatedAt: number;
  locales: string[];
  cases: CombineEvidencePackCase[];
  /** canonicalKey → locale → pack-relative PNG, so a finding can be shown beside the frame it came from. */
  byCanonicalKey: Record<string, Record<string, string>>;
  /** Shared Combine evidence findings over this pack's evidence. */
  analysis: CombineEvidenceAnalysis;
  /**
   * Text findings need a captured tree. Frames without one are still compared
   * for presence, so a pack states how much of it could be read.
   */
  analysisCoverage: { frames: number; inspectedFrames: number };
};

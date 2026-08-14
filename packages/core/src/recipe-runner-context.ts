import type { Recipe } from "./recipes.js";
import type { TestJob } from "./session.js";

export type RecipeStepContext = {
  log: (line: string) => void;
  /**
   * Owning job. Required for `pause` steps (drives job.status + resume
   * checkpoint) and used to attach `screenshot` frames to a run. Standalone
   * single-step execution (no job, e.g. server's POST /step/run) omits it —
   * `pause` throws in that case (rejected upstream) and `screenshot` simply
   * captures without attaching to a job.
   */
  job?: TestJob;
  /** Ephemeral values and evidence for authoring replay and standalone flows.
   * They provide the same assertion semantics without inventing a persisted
   * TestJob merely to verify a proposal. */
  variables?: Record<string, string>;
  artifacts?: { kind: string; capturedAt: number; data: unknown }[];
  moduleStack?: string[];
  recipeGraph?: Readonly<Record<string, Recipe>>;
  /** Test seam and provider override for pixel-only destination identity. */
  observeVisualFingerprint?: () => Promise<string | undefined>;
};

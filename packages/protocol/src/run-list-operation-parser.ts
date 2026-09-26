import type { OperationInput, OperationOutput } from "./operation-map.js";
import {
  boolean,
  fail,
  number,
  objectParser,
  record,
  string,
} from "./operation-parser-primitives.js";

export const runsParser = objectParser<OperationOutput<"run.list">>("runs response", (input) => {
  if (!Array.isArray(input.runs)) fail("runs", "must be an array");
  for (const item of input.runs) {
    const run = record(item, "run summary");
    string(run.id, "run summary id");
    string(run.action, "run summary action");
    number(run.writtenAt, "run summary writtenAt");
    number(run.artifactCount, "run summary artifactCount");
    number(run.artifactBytes, "run summary artifactBytes");
    number(run.storageBytes, "run summary storageBytes");
    boolean(run.pinned, "run summary pinned");
  }
  if (input.totalCount !== undefined) {
    if (
      typeof input.totalCount !== "number" ||
      !Number.isSafeInteger(input.totalCount) ||
      input.totalCount < input.runs.length
    ) {
      fail("runs totalCount", "must be a safe count at least as large as runs");
    }
  }
  if (input.nextCursor !== undefined) string(input.nextCursor, "runs nextCursor");
});

export const runListInputParser = objectParser<OperationInput<"run.list">>(
  "run list input",
  (input) => {
    if (input.limit !== undefined) {
      const raw = input.limit;
      const value = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : NaN;
      if (!Number.isFinite(value) || value < 1) fail("run list limit", "must be a positive number");
      input.limit = value;
    }
    if (input.appMapId !== undefined) string(input.appMapId, "run list App Map id");
    if (input.cursor !== undefined) string(input.cursor, "run list cursor");
    if (input.latestPerTest !== undefined) {
      if (input.latestPerTest === "true") input.latestPerTest = true;
      if (input.latestPerTest === "false") input.latestPerTest = false;
      if (typeof input.latestPerTest !== "boolean")
        fail("run list latestPerTest", "must be true or false");
    }
  },
);

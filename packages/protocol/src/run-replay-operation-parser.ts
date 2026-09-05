import { fail, objectParser, string } from "./operation-parser-primitives.js";

export const replayRunInputParser = objectParser<{
  runId: string;
  mode?: "saved-steps" | "same-configuration";
}>("replay run input", (input) => {
  string(input.runId, "run id");
  if (
    input.mode !== undefined &&
    input.mode !== "saved-steps" &&
    input.mode !== "same-configuration"
  ) {
    fail("replay mode", "must be saved-steps or same-configuration");
  }
});

export const runIdInputParser = objectParser<{ runId: string }>("run input", (input) => {
  string(input.runId, "run id");
});

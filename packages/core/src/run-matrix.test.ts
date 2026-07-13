import assert from "node:assert/strict";
import test from "node:test";
import { prepareRunMatrix } from "./run-matrix.js";

test("run matrices freeze list and generated values before execution", async () => {
  const matrix = await prepareRunMatrix({
    repetitions: 3,
    seed: 42,
    variables: [
      { id: "locale", name: "locale", source: "list", values: ["en", "pt"], fallback: "en" },
      {
        id: "prompt",
        name: "prompt",
        source: "generated",
        prompt: "Ask a geography question",
        fallback: "Where is Paris?",
      },
    ],
  });

  assert.equal(matrix.cases.length, 3);
  assert.deepEqual(
    matrix.cases.map((item) => item.values.locale),
    ["en", "pt", "en"],
  );
  assert.equal(new Set(matrix.cases.map((item) => item.values.prompt)).size, 3);
  assert.ok(matrix.cases.every((item) => item.provenance.length === 2));
});

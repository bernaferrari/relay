import assert from "node:assert/strict";
import test from "node:test";
import { evaluateVisual } from "./evaluation-visual.js";

const image = { mimeType: "image/png" as const, data: "AA==" };

test("visual judge fails closed without OPENROUTER_API_KEY", async () => {
  const previous = process.env.OPENROUTER_API_KEY;
  const previousProvider = process.env.RELAY_EVALUATION_PROVIDER;
  delete process.env.OPENROUTER_API_KEY;
  delete process.env.RELAY_EVALUATION_PROVIDER;
  try {
    await assert.rejects(
      () => evaluateVisual({ criteria: ["Composer is empty"], image }),
      /visual judge unavailable: OPENROUTER_API_KEY is not configured/u,
    );
  } finally {
    if (previous === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = previous;
    if (previousProvider === undefined) delete process.env.RELAY_EVALUATION_PROVIDER;
    else process.env.RELAY_EVALUATION_PROVIDER = previousProvider;
  }
});

test("visual judge never silently passes an unknown provider", async () => {
  await assert.rejects(
    () =>
      evaluateVisual({
        criteria: ["Composer is empty"],
        image,
        provider: "missing-visual-judge",
      }),
    /visual judge unavailable: provider is not configured \(missing-visual-judge\)/u,
  );
});

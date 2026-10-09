import type { SemanticEvaluationResult, VisualEvaluationRequest } from "@relay/protocol";
import { z } from "zod";
import { normalizeEvaluationResult } from "./evaluation.js";
import { createOpenRouterClient, openRouterCostUsd } from "./openrouter-ai-sdk.js";

function visualPrompt(input: VisualEvaluationRequest): string {
  return [
    "Evaluate the supplied screenshot against every criterion.",
    "Return only JSON with status (pass, fail, or uncertain), confidence (0..1), score (0..1), summary, and criteria.",
    "Each criteria item must contain id, description, passed, score, and optional evidence.",
    "The summary is shown to a person as 'Saw: <summary>'. Write one plain sentence describing what the screenshot actually shows that is relevant to the criteria; do not restate the criteria.",
    `Pass threshold: ${input.threshold ?? 0.9}`,
    `Criteria: ${JSON.stringify(input.criteria)}`,
    input.region
      ? `Attend to the crop at x=${input.region.x}, y=${input.region.y}, width=${input.region.width}, height=${input.region.height}.`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}

const visualProviders = new Map<
  string,
  { evaluate(input: VisualEvaluationRequest): Promise<SemanticEvaluationResult> }
>();

export function registerVisualEvaluationProvider(provider: {
  id: string;
  evaluate(input: VisualEvaluationRequest): Promise<SemanticEvaluationResult>;
}): () => void {
  visualProviders.set(provider.id, provider);
  return () => visualProviders.delete(provider.id);
}

async function evaluateViaOpenRouter(
  input: VisualEvaluationRequest,
): Promise<SemanticEvaluationResult> {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error("visual judge unavailable: OPENROUTER_API_KEY is not configured");
  const model = input.model ?? process.env.OPENROUTER_VISION_MODEL ?? "openai/gpt-4o-mini";
  try {
    const { sdk, provider } = await createOpenRouterClient({
      apiKey: key,
      httpReferer: process.env.OPENROUTER_HTTP_REFERER,
      appTitle: process.env.OPENROUTER_APP_TITLE ?? "Relay",
    });
    const generated = await sdk.generateObject({
      model: provider.chat(model),
      schema: z.record(z.string(), z.unknown()),
      schemaName: "relay_visual_evaluation",
      maxRetries: 0,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: visualPrompt(input) },
            {
              type: "file",
              data: Buffer.from(input.image.data, "base64"),
              mediaType: input.image.mimeType,
            },
          ],
        },
      ],
    });
    const result = normalizeEvaluationResult(
      generated.object,
      input,
      "openrouter",
      generated.response.modelId || model,
    );
    const costUsd = openRouterCostUsd(generated.providerMetadata);
    return costUsd === undefined ? result : { ...result, costUsd };
  } catch (error) {
    const message = error instanceof Error ? error.message : "request failed";
    throw new Error(`visual judge unavailable: OpenRouter ${message}`);
  }
}

export async function evaluateVisual(
  input: VisualEvaluationRequest,
): Promise<SemanticEvaluationResult> {
  const providerId = input.provider ?? process.env.RELAY_EVALUATION_PROVIDER ?? "openrouter";
  const registered = visualProviders.get(providerId);
  if (registered) return registered.evaluate(input);
  if (providerId === "openrouter") {
    return evaluateViaOpenRouter(input);
  }
  throw new Error(`visual judge unavailable: provider is not configured (${providerId})`);
}

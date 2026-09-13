import type { SemanticEvaluationResult, VisualEvaluationRequest } from "@relay/protocol";
import {
  attachEvaluationCost,
  normalizeEvaluationResult,
  parseEvaluationJson,
} from "./evaluation.js";

function visualPrompt(input: VisualEvaluationRequest): string {
  return [
    "Evaluate the supplied screenshot against every criterion.",
    "Return only JSON with status (pass, fail, or uncertain), confidence (0..1), score (0..1), summary, and criteria.",
    "Each criteria item must contain id, description, passed, score, and optional evidence.",
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

function asDataUrl(image: VisualEvaluationRequest["image"]): string {
  return `data:${image.mimeType};base64,${image.data}`;
}

async function evaluateViaOpenRouter(
  input: VisualEvaluationRequest,
): Promise<SemanticEvaluationResult> {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error("visual judge unavailable: OPENROUTER_API_KEY is not configured");
  const model = input.model ?? process.env.OPENROUTER_VISION_MODEL ?? "openai/gpt-4o-mini";
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      ...(process.env.OPENROUTER_HTTP_REFERER
        ? { "HTTP-Referer": process.env.OPENROUTER_HTTP_REFERER }
        : {}),
      ...(process.env.OPENROUTER_APP_TITLE ? { "X-Title": process.env.OPENROUTER_APP_TITLE } : {}),
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: visualPrompt(input) },
            { type: "image_url", image_url: { url: asDataUrl(input.image) } },
          ],
        },
      ],
      response_format: { type: "json_object" },
      usage: { include: true },
    }),
  });
  const body = (await response.json().catch(() => ({}))) as {
    choices?: { message?: { content?: unknown } }[];
    error?: { message?: string };
    usage?: unknown;
  };
  if (!response.ok) {
    throw new Error(
      `visual judge unavailable: OpenRouter ${body.error?.message ?? `HTTP ${response.status}`}`,
    );
  }
  const content = body.choices?.[0]?.message?.content;
  const text = typeof content === "string" ? content : "";
  if (!text.trim()) throw new Error("visual judge unavailable: OpenRouter returned no content");
  return attachEvaluationCost(
    normalizeEvaluationResult(parseEvaluationJson(text), input, "openrouter", model),
    body,
  );
}

export async function evaluateVisual(
  input: VisualEvaluationRequest,
): Promise<SemanticEvaluationResult> {
  const providerId = input.provider ?? process.env.RELAY_EVALUATION_PROVIDER ?? "openrouter";
  const registered = visualProviders.get(providerId);
  if (registered) return registered.evaluate(input);
  if (providerId === "openrouter" || providerId === "openai") {
    return evaluateViaOpenRouter(input);
  }
  throw new Error(`visual judge unavailable: provider is not configured (${providerId})`);
}

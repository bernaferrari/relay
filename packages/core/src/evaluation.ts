import type { SemanticEvaluationRequest, SemanticEvaluationResult } from "@relay/protocol";

export type EvaluationProvider = {
  id: string;
  evaluate(input: SemanticEvaluationRequest): Promise<SemanticEvaluationResult>;
};

const providers = new Map<string, EvaluationProvider>();

export function registerEvaluationProvider(provider: EvaluationProvider): () => void {
  providers.set(provider.id, provider);
  return () => providers.delete(provider.id);
}

function promptFor(input: SemanticEvaluationRequest): string {
  return [
    "Evaluate the supplied application response against every criterion.",
    "Return only JSON with status (pass, fail, or uncertain), confidence (0..1), score (0..1), summary, and criteria.",
    "Each criteria item must contain id, description, passed, score, and optional evidence.",
    `Pass threshold: ${input.threshold ?? 0.9}`,
    `Criteria: ${JSON.stringify(input.criteria)}`,
    `Application response: ${JSON.stringify(input.input)}`,
  ].join("\n");
}

function normalizeResult(
  raw: unknown,
  input: SemanticEvaluationRequest,
  provider: string,
  model: string,
): SemanticEvaluationResult {
  const value = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const rawCriteria = Array.isArray(value.criteria) ? value.criteria : [];
  const criteria = input.criteria.map((description, index) => {
    const item = rawCriteria[index];
    const record = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
    return {
      id: typeof record.id === "string" ? record.id : `criterion-${index + 1}`,
      description,
      passed: record.passed === true,
      score:
        typeof record.score === "number" && Number.isFinite(record.score)
          ? Math.max(0, Math.min(1, record.score))
          : record.passed === true
            ? 1
            : 0,
      ...(typeof record.evidence === "string" ? { evidence: record.evidence } : {}),
    };
  });
  const score =
    typeof value.score === "number" && Number.isFinite(value.score)
      ? Math.max(0, Math.min(1, value.score))
      : criteria.reduce((sum, item) => sum + item.score, 0) / criteria.length;
  const threshold = input.threshold ?? 0.9;
  const requestedStatus = value.status;
  const status =
    requestedStatus === "uncertain"
      ? "uncertain"
      : requestedStatus === "pass" || requestedStatus === "fail"
        ? requestedStatus
        : score >= threshold
          ? "pass"
          : "fail";
  return {
    status,
    confidence:
      typeof value.confidence === "number" && Number.isFinite(value.confidence)
        ? Math.max(0, Math.min(1, value.confidence))
        : 0.5,
    score,
    summary:
      typeof value.summary === "string" ? value.summary : `Semantic score ${score.toFixed(2)}`,
    criteria,
    provider,
    model,
    evaluatedAt: Date.now(),
  };
}

function parseJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1] ?? text;
  return JSON.parse(fenced.trim());
}

function registerBuiltins(): void {
  const openAiKey = process.env.OPENAI_API_KEY;
  if (openAiKey) {
    registerEvaluationProvider({
      id: "openai",
      async evaluate(input) {
        const model = input.model ?? process.env.OPENAI_MODEL ?? "gpt-4.1-mini";
        const response = await fetch("https://api.openai.com/v1/responses", {
          method: "POST",
          headers: { Authorization: `Bearer ${openAiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({ model, input: promptFor(input) }),
        });
        if (!response.ok)
          throw new Error(`semantic judge unavailable: OpenAI returned ${response.status}`);
        const body = (await response.json()) as {
          output_text?: string;
          output?: { content?: { text?: string }[] }[];
        };
        const text =
          body.output_text ??
          body.output
            ?.flatMap((item) => item.content ?? [])
            .map((item) => item.text ?? "")
            .join("\n") ??
          "";
        return normalizeResult(parseJson(text), input, "openai", model);
      },
    });
  }

  const localUrl = process.env.RELAY_LOCAL_EVALUATION_URL;
  if (localUrl) {
    registerEvaluationProvider({
      id: "local",
      async evaluate(input) {
        const model = input.model ?? "local";
        const response = await fetch(localUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...input, prompt: promptFor(input) }),
        });
        if (!response.ok)
          throw new Error(`semantic judge unavailable: local provider returned ${response.status}`);
        return normalizeResult(await response.json(), input, "local", model);
      },
    });
  }
}

registerBuiltins();

export async function evaluateSemantic(
  input: SemanticEvaluationRequest,
): Promise<SemanticEvaluationResult> {
  const providerId = input.provider ?? process.env.RELAY_EVALUATION_PROVIDER ?? "openai";
  const provider = providers.get(providerId);
  if (!provider)
    throw new Error(`semantic judge unavailable: provider is not configured (${providerId})`);
  return provider.evaluate(input);
}

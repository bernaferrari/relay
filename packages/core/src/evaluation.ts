import type { SemanticEvaluationRequest, SemanticEvaluationResult } from "@relay/protocol";
import { z } from "zod";
import {
  createOpenRouterClient,
  openRouterCostUsd,
  type OpenRouterAiSdkOptions,
} from "./openrouter-ai-sdk.js";

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

export function normalizeEvaluationResult(
  raw: unknown,
  input: Pick<SemanticEvaluationRequest, "criteria" | "threshold">,
  provider: string,
  model: string,
): SemanticEvaluationResult {
  const value = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const rawCriteria = Array.isArray(value.criteria) ? value.criteria : [];
  const issues: string[] = [];
  if (rawCriteria.length !== input.criteria.length) {
    issues.push("criteria count does not match the request");
  }
  const criteria = input.criteria.map((description, index) => {
    const item = rawCriteria[index];
    if (!item || typeof item !== "object") {
      issues.push(`criterion ${index + 1} is missing`);
    }
    const record = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
    const passed = record.passed;
    if (typeof passed !== "boolean") {
      issues.push(`criterion ${index + 1} has no boolean result`);
    }
    const rawScore = record.score;
    if (
      typeof rawScore !== "number" ||
      !Number.isFinite(rawScore) ||
      rawScore < 0 ||
      rawScore > 1
    ) {
      issues.push(`criterion ${index + 1} has an invalid score`);
    }
    if (passed === true && rawScore === 0) {
      issues.push(`criterion ${index + 1} is contradictory`);
    }
    if (passed === false && rawScore === 1) {
      issues.push(`criterion ${index + 1} is contradictory`);
    }
    return {
      // Criterion identity is canonical and positional. Provider-supplied ids
      // are display data at best and never become authority.
      id: `criterion-${index + 1}`,
      description,
      passed: passed === true,
      score: typeof rawScore === "number" && Number.isFinite(rawScore) ? rawScore : 0,
      ...(typeof record.evidence === "string" ? { evidence: record.evidence } : {}),
    };
  });
  const rawScore = value.score;
  if (
    rawScore !== undefined &&
    (typeof rawScore !== "number" || !Number.isFinite(rawScore) || rawScore < 0 || rawScore > 1)
  ) {
    issues.push("overall score is invalid");
  }
  const computedScore =
    criteria.length === 0
      ? 0
      : criteria.reduce((sum, item) => sum + item.score, 0) / criteria.length;
  // A provider may summarize below what the criteria support (a conservative
  // fail is honored), but an aggregate may never claim more than the criteria
  // average supports — that direction is an overclaim and is clamped.
  const providerOverall =
    typeof rawScore === "number" && Number.isFinite(rawScore) && rawScore >= 0 && rawScore <= 1
      ? rawScore
      : undefined;
  const score = providerOverall === undefined ? computedScore : Math.min(providerOverall, computedScore);
  const threshold = input.threshold ?? 0.9;
  const requestedStatus = value.status;
  if (
    requestedStatus !== undefined &&
    requestedStatus !== "pass" &&
    requestedStatus !== "fail" &&
    requestedStatus !== "uncertain"
  ) {
    issues.push("status is missing or invalid");
  }
  const rawConfidence = value.confidence;
  if (
    rawConfidence !== undefined &&
    (typeof rawConfidence !== "number" ||
      !Number.isFinite(rawConfidence) ||
      rawConfidence < 0 ||
      rawConfidence > 1)
  ) {
    issues.push("confidence is invalid");
  }
  const deterministicStatus =
    criteria.length > 0 && criteria.every((item) => item.passed) && score >= threshold
      ? "pass"
      : "fail";
  const status =
    issues.length > 0 || requestedStatus === "uncertain" ? "uncertain" : deterministicStatus;
  return {
    status,
    confidence:
      typeof value.confidence === "number" && Number.isFinite(value.confidence)
        ? Math.max(0, Math.min(1, value.confidence))
        : 0.5,
    score,
    summary:
      issues.length > 0
        ? `Provider response was incomplete or contradictory: ${issues.join("; ")}.`
        : typeof value.summary === "string"
          ? value.summary
          : `Semantic score ${score.toFixed(2)}`,
    criteria,
    provider,
    model,
    evaluatedAt: Date.now(),
  };
}

export function parseEvaluationJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1] ?? text;
  return JSON.parse(fenced.trim());
}

/** OpenRouter `usage.include` and OpenAI usage objects both expose a USD cost. */
export function evaluationCostUsd(body: unknown): number | undefined {
  if (!body || typeof body !== "object") return undefined;
  const usage = (body as { usage?: unknown }).usage;
  if (!usage || typeof usage !== "object") return undefined;
  const record = usage as Record<string, unknown>;
  for (const key of ["cost", "total_cost", "costUsd", "total_cost_usd"] as const) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) return value;
  }
  return undefined;
}

export function attachEvaluationCost(
  result: SemanticEvaluationResult,
  body: unknown,
): SemanticEvaluationResult {
  const costUsd = evaluationCostUsd(body);
  return costUsd === undefined ? result : { ...result, costUsd };
}

export function formatEvaluationCost(costUsd: number | undefined): string {
  if (costUsd === undefined) return "";
  return ` · $${costUsd < 0.01 ? costUsd.toFixed(4) : costUsd.toFixed(2)}`;
}

function registerBuiltins(): void {
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
        return normalizeEvaluationResult(await response.json(), input, "local", model);
      },
    });
  }

  const openRouterKey = process.env.OPENROUTER_API_KEY;
  if (openRouterKey) {
    registerEvaluationProvider(
      createOpenRouterEvaluationProvider({
        apiKey: openRouterKey,
        model: process.env.OPENROUTER_MODEL,
        httpReferer: process.env.OPENROUTER_HTTP_REFERER,
        appTitle: process.env.OPENROUTER_APP_TITLE ?? "Relay",
      }),
    );
  }
}

registerBuiltins();

export async function evaluateSemantic(
  input: SemanticEvaluationRequest,
): Promise<SemanticEvaluationResult> {
  const providerId = input.provider ?? process.env.RELAY_EVALUATION_PROVIDER ?? "openrouter";
  const provider = providers.get(providerId);
  if (!provider)
    throw new Error(`semantic judge unavailable: provider is not configured (${providerId})`);
  const result = await provider.evaluate(input);
  // Every provider result — builtin or custom — passes the same policy gate.
  // Registration alone never grants authority to declare an unearned pass.
  const enforced = normalizeEvaluationResult(
    result,
    input,
    providerId,
    typeof result.model === "string" && result.model ? result.model : "unknown",
  );
  return typeof result.costUsd === "number" ? { ...enforced, costUsd: result.costUsd } : enforced;
}

export type OpenRouterEvaluationProviderOptions = Omit<OpenRouterAiSdkOptions, "apiKey"> & {
  apiKey?: string;
  model?: string;
};

const semanticEvaluationSchema = z.record(z.string(), z.unknown());

/** Optional semantic evaluation through the one OpenRouter/Vercel AI SDK seam. */
export function createOpenRouterEvaluationProvider(
  options: OpenRouterEvaluationProviderOptions = {},
): EvaluationProvider {
  return {
    id: "openrouter",
    async evaluate(input) {
      const apiKey = options.apiKey ?? process.env.OPENROUTER_API_KEY;
      if (!apiKey) {
        throw new Error("semantic judge unavailable: OPENROUTER_API_KEY is not configured");
      }
      const model =
        input.model ?? options.model ?? process.env.OPENROUTER_MODEL ?? "openai/gpt-4o-mini";
      try {
        const { sdk, provider } = await createOpenRouterClient({
          apiKey,
          endpoint: options.endpoint,
          fetch: options.fetch,
          httpReferer: options.httpReferer ?? process.env.OPENROUTER_HTTP_REFERER,
          appTitle: options.appTitle ?? process.env.OPENROUTER_APP_TITLE ?? "Relay",
        });
        const generated = await sdk.generateObject({
          model: provider.chat(model),
          prompt: promptFor(input),
          schema: semanticEvaluationSchema,
          schemaName: "relay_semantic_evaluation",
          maxRetries: 0,
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
        throw new Error(`semantic judge unavailable: OpenRouter ${message}`);
      }
    },
  };
}

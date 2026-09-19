import { randomUUID } from "node:crypto";
import type {
  ModelChoiceAnswer,
  ModelDecisionAnswer,
  ModelDecisionQuestion,
  ModelDecisionRecord,
  ModelDecisionRequest,
  ModelDecisionJson,
  ModelNoulAnswer,
  ModelScoreAnswer,
} from "@relay/protocol";
import { measureBoundedJsonValue } from "@relay/protocol";
import { canonicalSha256 } from "./canonical-json.js";
import {
  createOpenRouterClient,
  OPENROUTER_CHAT_COMPLETIONS,
  type OpenRouterClient,
} from "./openrouter-ai-sdk.js";
import { redactSensitiveEvidenceValue } from "./redaction.js";

export const DEFAULT_OPENROUTER_DECISION_MODEL = "~typesafe/jev-latest" as const;
const MAX_QUESTIONS = 16;
const MAX_ATTEMPTS = 3;
const RETRYABLE_STATUSES = new Set([429, 529]);
const JSON_LIMITS = {
  maxDepth: 16,
  maxStringBytes: 64 * 1024,
  maxArrayItems: 200,
  maxObjectEntries: 200,
  maxNodes: 5_000,
  maxSerializedBytes: 256 * 1024,
} as const;

const DEFAULT_MODEL_EGRESS_ORIGINS = ["https://openrouter.ai"];

/** Egress policy gate for model calls. Redaction bounds WHAT leaves this
 * process; this bounds WHERE it may go. Returns a blocking reason or null. */
export function modelEgressBlockedReason(
  endpoint: string,
  allowedEndpointOrigins: readonly string[] = [],
): string | null {
  if (process.env.RELAY_MODEL_EGRESS === "disabled") {
    return "model egress is disabled by policy (RELAY_MODEL_EGRESS=disabled)";
  }
  let origin: string;
  try {
    origin = new URL(endpoint).origin;
  } catch {
    return `model endpoint ${endpoint} is not a valid URL`;
  }
  const allowed = new Set([...DEFAULT_MODEL_EGRESS_ORIGINS, ...allowedEndpointOrigins]);
  if (!allowed.has(origin)) {
    return `model endpoint origin ${origin} is not allowed; allow it explicitly via allowedEndpointOrigins`;
  }
  return null;
}

type JsonSchema = Record<string, unknown>;

export type OpenRouterDecisionProviderOptions = {
  apiKey?: string;
  model?: string;
  endpoint?: string;
  httpReferer?: string;
  appTitle?: string;
  fetch?: typeof globalThis.fetch;
  now?: () => number;
  requestId?: () => string;
  sleep?: (milliseconds: number) => Promise<void>;
  maxAttempts?: number;
  /** Extra endpoint origins this deployment explicitly allows for model
   * egress. Defaults to the official OpenRouter origin only. */
  allowedEndpointOrigins?: string[];
};

export type ModelDecisionProvider = {
  id: "openrouter";
  decide(request: ModelDecisionRequest): Promise<ModelDecisionRecord>;
};

function finiteNumber(
  value: unknown,
  minimum = 0,
  maximum = Number.POSITIVE_INFINITY,
): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= minimum && value <= maximum
    ? value
    : null;
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function sameKeys(actual: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(actual).sort();
  return (
    keys.length === expected.length &&
    keys.every((key, index) => key === [...expected].sort()[index])
  );
}

function choiceAnswer(
  value: unknown,
  question: Extract<ModelDecisionQuestion, { type: "choice" }>,
): ModelChoiceAnswer | null {
  const record = objectValue(value);
  if (!record || record.type !== "choice" || typeof record.choice !== "string") return null;
  const optionKeys = Object.keys(question.criteria);
  if (!optionKeys.includes(record.choice)) return null;
  const probabilities = objectValue(record.probabilities);
  const confidence = finiteNumber(record.confidence, 0, 1);
  if (!probabilities || confidence === null || !sameKeys(probabilities, optionKeys)) return null;
  const values = optionKeys.map((key) => finiteNumber(probabilities[key], 0, 1));
  if (values.some((item) => item === null)) return null;
  const total = values.reduce<number>((sum, item) => sum + (item ?? 0), 0);
  if (Math.abs(total - 1) > 1e-6) return null;
  return {
    type: "choice",
    choice: record.choice,
    probabilities: Object.fromEntries(optionKeys.map((key, index) => [key, values[index]!])),
    confidence,
  };
}

function scoreAnswer(
  value: unknown,
  question: Extract<ModelDecisionQuestion, { type: "score" }>,
): ModelScoreAnswer | null {
  const record = objectValue(value);
  if (!record || record.type !== "score") return null;
  const score = finiteNumber(record.score, 0, question.criteria.length - 1);
  const confidence = finiteNumber(record.confidence, 0, 1);
  const legend = objectValue(record.legend);
  const probabilities = objectValue(record.probabilities);
  const levelKeys = question.criteria.map((_, index) => String(index));
  if (score === null || confidence === null || !legend || !probabilities) return null;
  if (!sameKeys(legend, levelKeys) || !sameKeys(probabilities, levelKeys)) return null;
  if (levelKeys.some((key, index) => legend[key] !== question.criteria[index])) return null;
  const values = levelKeys.map((key) => finiteNumber(probabilities[key], 0, 1));
  if (values.some((item) => item === null)) return null;
  const total = values.reduce<number>((sum, item) => sum + (item ?? 0), 0);
  if (Math.abs(total - 1) > 1e-6) return null;
  return {
    type: "score",
    score,
    legend: Object.fromEntries(levelKeys.map((key, index) => [key, question.criteria[index]!])),
    probabilities: Object.fromEntries(levelKeys.map((key, index) => [key, values[index]!])),
    confidence,
  };
}

function noulAnswer(value: unknown): ModelNoulAnswer | null {
  const record = objectValue(value);
  const noul = finiteNumber(record?.noul, 0, 1);
  return record?.type === "noul" && noul !== null ? { type: "noul", noul } : null;
}

function validateAnswers(
  raw: unknown,
  questions: Record<string, ModelDecisionQuestion>,
): { answers: Record<string, ModelDecisionAnswer> } | { error: string } {
  const outer = objectValue(raw);
  const answers = objectValue(outer?.answers) ?? outer;
  if (!answers || !sameKeys(answers, Object.keys(questions))) {
    return { error: "response answers do not match the requested question ids" };
  }
  const normalized: Record<string, ModelDecisionAnswer> = {};
  for (const [id, question] of Object.entries(questions)) {
    const value = answers[id];
    const answer =
      question.type === "noul"
        ? noulAnswer(value)
        : question.type === "choice"
          ? choiceAnswer(value, question)
          : scoreAnswer(value, question);
    if (!answer) return { error: `response answer is invalid for question ${id}` };
    normalized[id] = answer;
  }
  return { answers: normalized };
}

function questionSchema(question: ModelDecisionQuestion): JsonSchema {
  if (question.type === "noul") {
    return {
      type: "object",
      properties: { type: { const: "noul" }, noul: { type: "number", minimum: 0, maximum: 1 } },
      required: ["type", "noul"],
      additionalProperties: false,
    };
  }
  if (question.type === "choice") {
    const keys = Object.keys(question.criteria);
    return {
      type: "object",
      properties: {
        type: { const: "choice" },
        choice: { type: "string", enum: keys },
        probabilities: {
          type: "object",
          properties: Object.fromEntries(
            keys.map((key) => [key, { type: "number", minimum: 0, maximum: 1 }]),
          ),
          required: keys,
          additionalProperties: false,
        },
        confidence: { type: "number", minimum: 0, maximum: 1 },
      },
      required: ["type", "choice", "probabilities", "confidence"],
      additionalProperties: false,
    };
  }
  const keys = question.criteria.map((_, index) => String(index));
  return {
    type: "object",
    properties: {
      type: { const: "score" },
      score: { type: "number", minimum: 0, maximum: question.criteria.length - 1 },
      legend: {
        type: "object",
        properties: Object.fromEntries(
          keys.map((key, index) => [key, { const: question.criteria[index] }]),
        ),
        required: keys,
        additionalProperties: false,
      },
      probabilities: {
        type: "object",
        properties: Object.fromEntries(
          keys.map((key) => [key, { type: "number", minimum: 0, maximum: 1 }]),
        ),
        required: keys,
        additionalProperties: false,
      },
      confidence: { type: "number", minimum: 0, maximum: 1 },
    },
    required: ["type", "score", "legend", "probabilities", "confidence"],
    additionalProperties: false,
  };
}

function responseSchema(questions: Record<string, ModelDecisionQuestion>): JsonSchema {
  return {
    type: "object",
    properties: {
      answers: {
        type: "object",
        properties: Object.fromEntries(
          Object.entries(questions).map(([id, question]) => [id, questionSchema(question)]),
        ),
        required: Object.keys(questions),
        additionalProperties: false,
      },
    },
    required: ["answers"],
    additionalProperties: false,
  };
}

function requestError(request: ModelDecisionRequest): string | null {
  if (!request || typeof request !== "object") return "request is not an object";
  if (request.schemaVersion !== 1 || request.provider !== "openrouter") {
    return "request schema or provider is not supported";
  }
  if (typeof request.model !== "string" || !request.model.trim()) return "request model is empty";
  if (
    !request.questions ||
    typeof request.questions !== "object" ||
    Array.isArray(request.questions)
  ) {
    return "request questions are not an object";
  }
  const questionEntries = Object.entries(request.questions);
  if (questionEntries.length === 0 || questionEntries.length > MAX_QUESTIONS) {
    return `request must contain between 1 and ${MAX_QUESTIONS} questions`;
  }
  try {
    // This is an egress boundary. Enforce bounds before redaction or serialization.
    measureBoundedJsonValue(request.state, JSON_LIMITS, "decision state");
    measureBoundedJsonValue(request.questions, JSON_LIMITS, "decision questions");
  } catch (error) {
    return error instanceof Error ? error.message : "request JSON is not bounded";
  }
  for (const [id, question] of questionEntries) {
    if (
      !question ||
      typeof question !== "object" ||
      Array.isArray(question) ||
      !/^[A-Za-z][A-Za-z0-9_.-]{0,63}$/u.test(id) ||
      typeof question.instructions !== "string" ||
      !question.instructions.trim() ||
      (question.type !== "noul" && question.type !== "choice" && question.type !== "score")
    ) {
      return `question ${id || "<empty>"} has an invalid id or instructions`;
    }
    if (
      question.type === "choice" &&
      (!question.criteria ||
        typeof question.criteria !== "object" ||
        Array.isArray(question.criteria) ||
        Object.keys(question.criteria).length < 2)
    ) {
      return `choice question ${id} must have at least two options`;
    }
    if (
      question.type === "score" &&
      (!Array.isArray(question.criteria) ||
        question.criteria.length < 2 ||
        question.criteria.some((item) => typeof item !== "string"))
    ) {
      return `score question ${id} must have at least two levels`;
    }
  }
  return null;
}

function errorStatus(error: unknown): number | undefined {
  if (!error || typeof error !== "object") return undefined;
  const value =
    (error as { statusCode?: unknown; status?: unknown }).statusCode ??
    (error as { status?: unknown }).status;
  return typeof value === "number" && Number.isInteger(value) ? value : undefined;
}

function errorText(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (error && typeof error === "object") {
    const record = error as { responseBody?: unknown; message?: unknown };
    if (typeof record.message === "string" && record.message.trim()) return record.message;
    if (typeof record.responseBody === "string" && record.responseBody.trim()) {
      return record.responseBody;
    }
  }
  return "OpenRouter request failed";
}

function isInvalidProviderResponse(error: unknown, status: number | undefined): boolean {
  if (error && typeof error === "object") {
    const name = (error as { name?: unknown }).name;
    if (typeof name === "string" && /No(?:Object|Output)GeneratedError/u.test(name)) return true;
  }
  if (
    /(?:invalid json response|no choice in response|type validation failed|no (?:object|output) generated)/iu.test(
      errorText(error),
    )
  ) {
    return true;
  }
  // A successful HTTP response that the SDK cannot validate is a malformed
  // provider response, not a transient provider outage.
  return status !== undefined && status >= 200 && status < 300;
}

function sdkUsage(usage: {
  inputTokens?: number;
  outputTokens?: number;
}): { inputTokens: number; outputTokens: number } | undefined {
  const input = finiteNumber(usage.inputTokens, 0);
  const output = finiteNumber(usage.outputTokens, 0);
  return input !== null && output !== null
    ? { inputTokens: Math.trunc(input), outputTokens: Math.trunc(output) }
    : undefined;
}

function recordBase(
  request: ModelDecisionRequest,
  requestId: string,
  startedAt: number,
  completedAt: number,
): Omit<ModelDecisionRecord, "status" | "model" | "error" | "answers" | "usage"> {
  const evidenceRefs = (
    redactSensitiveEvidenceValue(request.evidenceRefs ?? []) as unknown[]
  ).filter((value): value is string => typeof value === "string");
  return {
    schemaVersion: 1,
    provider: "openrouter",
    requestId,
    observationDigest: request.observationDigest,
    questionDigest: request.questionDigest ?? canonicalSha256(request.questions),
    startedAt,
    completedAt,
    durationMs: Math.max(0, completedAt - startedAt),
    evidenceRefs,
  };
}

/**
 * One OpenRouter-only adapter for optional, review-only Jev suggestions.
 * It never mutates a target and returns a durable invalid/unavailable record
 * instead of making model output a control-flow dependency.
 */
export function createOpenRouterDecisionProvider(
  options: OpenRouterDecisionProviderOptions = {},
): ModelDecisionProvider {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const now = options.now ?? Date.now;
  const requestId = options.requestId ?? randomUUID;
  const sleep =
    options.sleep ??
    ((milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  const apiKey = options.apiKey ?? process.env.OPENROUTER_API_KEY;
  const model =
    options.model ?? process.env.OPENROUTER_DECISION_MODEL ?? DEFAULT_OPENROUTER_DECISION_MODEL;
  const endpoint = options.endpoint ?? OPENROUTER_CHAT_COMPLETIONS;
  const maxAttempts = Math.max(
    1,
    Math.min(MAX_ATTEMPTS, Math.trunc(options.maxAttempts ?? MAX_ATTEMPTS)),
  );
  let openRouterAiSdkPromise: Promise<OpenRouterClient> | undefined;

  return {
    id: "openrouter",
    async decide(request) {
      const id = requestId();
      const startedAt = now();
      const invalidRequest = requestError(request);
      if (invalidRequest) {
        const completedAt = now();
        return {
          ...recordBase(request, id, startedAt, completedAt),
          status: "invalid",
          model: request.model || model,
          error: { code: "request-rejected", message: invalidRequest },
        };
      }
      if (!apiKey || !fetchImpl) {
        const completedAt = now();
        return {
          ...recordBase(request, id, startedAt, completedAt),
          status: "unavailable",
          model: request.model || model,
          error: { code: "provider-unavailable", message: "OpenRouter is not configured" },
        };
      }
      const egressBlocked = modelEgressBlockedReason(endpoint, options.allowedEndpointOrigins ?? []);
      if (egressBlocked) {
        const completedAt = now();
        return {
          ...recordBase(request, id, startedAt, completedAt),
          status: "unavailable",
          model: request.model || model,
          error: { code: "provider-unavailable", message: egressBlocked },
        };
      }

      const safeState = redactSensitiveEvidenceValue(request.state) as ModelDecisionJson;
      const safeQuestions = redactSensitiveEvidenceValue(request.questions) as Record<
        string,
        ModelDecisionQuestion
      >;
      const requestedModel = request.model || model;
      let generated:
        | {
            output: { answers: unknown };
            response: { modelId: string };
            usage: { inputTokens?: number; outputTokens?: number };
          }
        | undefined;
      let lastError: unknown;
      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        try {
          openRouterAiSdkPromise ??= createOpenRouterClient({
            apiKey,
            endpoint,
            fetch: fetchImpl,
            httpReferer: options.httpReferer,
            appTitle: options.appTitle,
          });
          const { sdk, provider } = await openRouterAiSdkPromise;
          const output = sdk.Output.object({
            schema: sdk.jsonSchema<{ answers: unknown }>(responseSchema(request.questions)),
            name: "relay_model_decision",
          });
          generated = await sdk.generateText({
            model: provider.chat(requestedModel),
            messages: [
              {
                role: "user",
                content: JSON.stringify({ state: safeState, questions: safeQuestions }),
              },
            ],
            output,
            maxRetries: 0,
          });
        } catch (error) {
          lastError = error;
          const status = errorStatus(error);
          if (!RETRYABLE_STATUSES.has(status ?? 0) || attempt === maxAttempts) break;
          await sleep(250 * 2 ** (attempt - 1));
        }
        if (generated) break;
      }

      const completedAt = now();
      if (!generated) {
        const status = errorStatus(lastError);
        const retryable = RETRYABLE_STATUSES.has(status ?? 0);
        const rejected = typeof status === "number" && status >= 400 && status < 500;
        const invalidResponse = isInvalidProviderResponse(lastError, status);
        return {
          ...recordBase(request, id, startedAt, completedAt),
          status: rejected || invalidResponse ? "invalid" : "unavailable",
          model: requestedModel,
          error: {
            code: rejected
              ? "request-rejected"
              : invalidResponse
                ? "invalid-response"
                : "provider-unavailable",
            message: `${retryable ? "OpenRouter remained unavailable" : rejected ? "OpenRouter rejected the request" : invalidResponse ? "OpenRouter returned an invalid response" : "OpenRouter request failed"}: ${errorText(lastError)}`,
          },
        };
      }

      const validated = validateAnswers(generated.output, request.questions);
      if ("error" in validated) {
        return {
          ...recordBase(request, id, startedAt, completedAt),
          status: "invalid",
          model: generated.response.modelId || requestedModel,
          usage: sdkUsage(generated.usage),
          error: { code: "invalid-response", message: validated.error },
        };
      }
      return {
        ...recordBase(request, id, startedAt, completedAt),
        status: "ok",
        model: generated.response.modelId || requestedModel,
        answers: validated.answers,
        usage: sdkUsage(generated.usage),
      };
    },
  };
}

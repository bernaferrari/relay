import { setTimeout as delay } from "node:timers/promises";
import { randomUUID } from "node:crypto";
import type {
  ModelChoiceAnswer,
  ModelDecisionAnswer,
  ModelDecisionQuestion,
  ModelDecisionRecord,
  ModelDecisionRequest,
  ModelDecisionUsage,
  ModelDecisionJson,
  ModelNoulAnswer,
  ModelScoreAnswer,
  ModelUncertaintySource,
} from "@relay/protocol";
import { measureBoundedJsonValue } from "@relay/protocol";
import { canonicalSha256 } from "./canonical-json.js";
import { redactSensitiveEvidenceValue } from "./redaction.js";

/** Official OpenRouter Decisions transport (typescript-sdk alphaDecisionsCreate). */
export const OPENROUTER_DECISIONS_ENDPOINT = "https://openrouter.ai/api/alpha/decisions";
/** Structured-generation fallback transport for a configured general chat model. */
export const OPENROUTER_CHAT_COMPLETIONS_ENDPOINT =
  "https://openrouter.ai/api/v1/chat/completions";
export const DEFAULT_OPENROUTER_DECISION_MODEL = "~typesafe/jev-latest" as const;
const MAX_QUESTIONS = 16;
const MAX_ATTEMPTS = 3;
const DEFAULT_TIMEOUT_MS = 60_000;
const RETRYABLE_STATUSES = new Set([429, 529]);
const JSON_LIMITS = {
  maxDepth: 16,
  maxStringBytes: 64 * 1024,
  maxArrayItems: 200,
  maxObjectEntries: 200,
  maxNodes: 5_000,
  maxSerializedBytes: 256 * 1024,
} as const;

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
  /** Per-attempt deadline. Inference must be bounded like any other call. */
  timeoutMs?: number;
  /** External cancellation (goal deadline, job cancellation). */
  signal?: AbortSignal;
  /** Extra endpoint origins this deployment explicitly allows for model
   * egress. Defaults to the official OpenRouter origin only. */
  allowedEndpointOrigins?: string[];
};

export type ModelDecisionProvider = {
  id: "openrouter";
  decide(request: ModelDecisionRequest): Promise<ModelDecisionRecord>;
};

type ErrorResponse = { error?: { message?: unknown } };

type ChatCompletionsResponse = ErrorResponse & {
  id?: unknown;
  model?: unknown;
  choices?: Array<{ message?: { content?: unknown } }>;
  usage?: {
    input_tokens?: unknown;
    output_tokens?: unknown;
    prompt_tokens?: unknown;
    completion_tokens?: unknown;
    cost?: unknown;
  };
};

type NativeDecisionsResponse = ErrorResponse & {
  id?: unknown;
  model?: unknown;
  provider?: unknown;
  answers?: unknown;
  usage?: { input_tokens?: unknown; output_tokens?: unknown; cost?: unknown };
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

function parseContent(content: unknown): unknown {
  if (typeof content === "string") {
    const trimmed = content.trim();
    if (!trimmed) return null;
    try {
      return JSON.parse(trimmed) as unknown;
    } catch {
      return null;
    }
  }
  if (Array.isArray(content)) {
    const text = content
      .map((part) => {
        const record = objectValue(part);
        return typeof record?.text === "string" ? record.text : "";
      })
      .join("")
      .trim();
    return text ? parseContent(text) : null;
  }
  return content;
}

/** Validate a probability map against the offered option keys. Native
 * distributions may cover a subset; every present value must be a finite
 * probability in [0, 1]. */
function boundedProbabilityMap(
  value: unknown,
  optionKeys: readonly string[],
): Record<string, number> | undefined {
  const record = objectValue(value);
  if (!record) return undefined;
  const entries: Array<[string, number]> = [];
  for (const [key, raw] of Object.entries(record)) {
    if (!optionKeys.includes(key)) return undefined;
    const probability = finiteNumber(raw, 0, 1);
    if (probability === null) return undefined;
    entries.push([key, probability]);
  }
  return Object.fromEntries(entries);
}

/** Strict validation for self-reported chat answers: the full option set must
 * be present and sum to one — a generated confidence cannot masquerade as a
 * native distribution, so it must at least be internally consistent. */
function selfReportedProbabilityMap(
  value: unknown,
  optionKeys: readonly string[],
): Record<string, number> | null {
  const record = objectValue(value);
  if (!record || !sameKeys(record, optionKeys)) return null;
  const values = optionKeys.map((key) => finiteNumber(record[key], 0, 1));
  if (values.some((item) => item === null)) return null;
  const total = values.reduce<number>((sum, item) => sum + (item ?? 0), 0);
  if (Math.abs(total - 1) > 1e-6) return null;
  return Object.fromEntries(optionKeys.map((key, index) => [key, values[index]!]));
}

function nativeChoiceAnswer(
  value: unknown,
  question: Extract<ModelDecisionQuestion, { type: "choice" }>,
): ModelChoiceAnswer | null {
  const record = objectValue(value);
  if (!record || record.type !== "choice" || typeof record.choice !== "string") return null;
  const optionKeys = Object.keys(question.criteria);
  if (!optionKeys.includes(record.choice)) return null;
  const probabilities = boundedProbabilityMap(record.probabilities, optionKeys);
  const confidence = record.confidence === undefined ? undefined : finiteNumber(record.confidence, 0, 1);
  if (probabilities === undefined && record.probabilities !== undefined) return null;
  if (confidence === null) return null;
  return {
    type: "choice",
    choice: record.choice,
    ...(probabilities && Object.keys(probabilities).length > 0 ? { probabilities } : {}),
    ...(confidence !== undefined ? { confidence } : {}),
  };
}

function selfReportedChoiceAnswer(
  value: unknown,
  question: Extract<ModelDecisionQuestion, { type: "choice" }>,
): ModelChoiceAnswer | null {
  const record = objectValue(value);
  if (!record || record.type !== "choice" || typeof record.choice !== "string") return null;
  const optionKeys = Object.keys(question.criteria);
  if (!optionKeys.includes(record.choice)) return null;
  const probabilities = selfReportedProbabilityMap(record.probabilities, optionKeys);
  const confidence = finiteNumber(record.confidence, 0, 1);
  if (!probabilities || confidence === null) return null;
  return { type: "choice", choice: record.choice, probabilities, confidence };
}

function nativeScoreAnswer(
  value: unknown,
  question: Extract<ModelDecisionQuestion, { type: "score" }>,
): ModelScoreAnswer | null {
  const record = objectValue(value);
  if (!record || record.type !== "score") return null;
  const score = finiteNumber(record.score, 0, question.criteria.length - 1);
  if (score === null) return null;
  const levelKeys = question.criteria.map((_, index) => String(index));
  const probabilities = boundedProbabilityMap(record.probabilities, levelKeys);
  if (probabilities === undefined && record.probabilities !== undefined) return null;
  const confidence = record.confidence === undefined ? undefined : finiteNumber(record.confidence, 0, 1);
  if (confidence === null) return null;
  const legend = objectValue(record.legend);
  if (legend) {
    if (!sameKeys(legend, levelKeys)) return null;
    if (levelKeys.some((key, index) => legend[key] !== question.criteria[index])) return null;
  } else if (record.legend !== undefined) {
    return null;
  }
  return {
    type: "score",
    score,
    ...(legend ? { legend: Object.fromEntries(levelKeys.map((key, index) => [key, question.criteria[index]!])) } : {}),
    ...(probabilities && Object.keys(probabilities).length > 0 ? { probabilities } : {}),
    ...(confidence !== undefined ? { confidence } : {}),
  };
}

function selfReportedScoreAnswer(
  value: unknown,
  question: Extract<ModelDecisionQuestion, { type: "score" }>,
): ModelScoreAnswer | null {
  const record = objectValue(value);
  if (!record || record.type !== "score") return null;
  const score = finiteNumber(record.score, 0, question.criteria.length - 1);
  const confidence = finiteNumber(record.confidence, 0, 1);
  const legend = objectValue(record.legend);
  const probabilitiesRecord = objectValue(record.probabilities);
  const levelKeys = question.criteria.map((_, index) => String(index));
  if (score === null || confidence === null || !legend || !probabilitiesRecord) return null;
  if (!sameKeys(legend, levelKeys)) return null;
  if (levelKeys.some((key, index) => legend[key] !== question.criteria[index])) return null;
  const probabilities = selfReportedProbabilityMap(record.probabilities, levelKeys);
  if (!probabilities) return null;
  return {
    type: "score",
    score,
    legend: Object.fromEntries(levelKeys.map((key, index) => [key, question.criteria[index]!])),
    probabilities,
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
  mode: "native" | "self-reported",
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
          ? mode === "native"
            ? nativeChoiceAnswer(value, question)
            : selfReportedChoiceAnswer(value, question)
          : mode === "native"
            ? nativeScoreAnswer(value, question)
            : selfReportedScoreAnswer(value, question);
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

function usageFromTokens(input: unknown, output: unknown, cost?: unknown): ModelDecisionUsage | undefined {
  const inputTokens = finiteNumber(input, 0);
  const outputTokens = finiteNumber(output, 0);
  if (inputTokens === null || outputTokens === null) return undefined;
  const costUsd = finiteNumber(cost, 0);
  return {
    inputTokens: Math.trunc(inputTokens),
    outputTokens: Math.trunc(outputTokens),
    ...(costUsd !== null ? { costUsd } : {}),
  };
}

function errorMessage(body: ErrorResponse, status: number): string {
  return typeof body.error?.message === "string"
    ? body.error.message
    : `OpenRouter returned HTTP ${status}`;
}

function recordBase(
  request: ModelDecisionRequest,
  requestId: string,
  startedAt: number,
  completedAt: number,
  uncertaintySource: ModelUncertaintySource,
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
    uncertaintySource,
    startedAt,
    completedAt,
    durationMs: Math.max(0, completedAt - startedAt),
    evidenceRefs,
  };
}

type SharedRuntime = {
  fetchImpl: typeof globalThis.fetch;
  now: () => number;
  requestId: () => string;
  sleep: (milliseconds: number) => Promise<void>;
  apiKey?: string;
  model: string;
  maxAttempts: number;
  timeoutMs: number;
  signal?: AbortSignal;
  httpReferer?: string;
  appTitle?: string;
  allowedEndpointOrigins: string[];
};

const DEFAULT_ALLOWED_ENDPOINT_ORIGINS = ["https://openrouter.ai"];

/** Egress policy gate for model calls. Redaction bounds WHAT leaves this
 * process; this bounds WHERE it may go. Returns a blocking reason or null. */
export function modelEgressBlockedReason(
  endpoint: string,
  allowedEndpointOrigins: readonly string[],
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
  const allowed = new Set([...DEFAULT_ALLOWED_ENDPOINT_ORIGINS, ...allowedEndpointOrigins]);
  if (!allowed.has(origin)) {
    return `model endpoint origin ${origin} is not allowed; allow it explicitly via allowedEndpointOrigins`;
  }
  return null;
}

/** One bounded POST with retry on rate limits and provider overload. */
async function postWithRetry(
  runtime: SharedRuntime,
  endpoint: string,
  body: Record<string, unknown>,
): Promise<
  | { ok: true; body: Record<string, unknown> }
  | { ok: false; status: number; body: Record<string, unknown>; retryable: boolean; aborted: boolean }
> {
  let response: Response | undefined;
  let responseBody: Record<string, unknown> = {};
  for (let attempt = 1; attempt <= runtime.maxAttempts; attempt += 1) {
    const controller = new AbortController();
    const deadline = setTimeout(
      () => controller.abort(),
      Math.max(1, runtime.timeoutMs),
    );
    const onExternalAbort = () => controller.abort();
    runtime.signal?.addEventListener("abort", onExternalAbort, { once: true });
    try {
      response = await runtime.fetchImpl(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${runtime.apiKey}`,
          "Content-Type": "application/json",
          ...(runtime.httpReferer ? { "HTTP-Referer": runtime.httpReferer } : {}),
          ...(runtime.appTitle ? { "X-Title": runtime.appTitle } : {}),
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      responseBody = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    } catch (error) {
      return {
        ok: false,
        status: 0,
        body: {},
        retryable: true,
        aborted: error instanceof Error && error.name === "AbortError",
      };
    } finally {
      clearTimeout(deadline);
      runtime.signal?.removeEventListener("abort", onExternalAbort);
    }
    if (response.ok || !RETRYABLE_STATUSES.has(response.status) || attempt === runtime.maxAttempts)
      break;
    await runtime.sleep(250 * 2 ** (attempt - 1));
  }
  if (response?.ok) return { ok: true, body: responseBody };
  return {
    ok: false,
    status: response?.status ?? 0,
    body: responseBody,
    retryable: response ? RETRYABLE_STATUSES.has(response.status) : true,
    aborted: false,
  };
}

function sharedRuntime(options: OpenRouterDecisionProviderOptions, fallbackModel: string): SharedRuntime {
  return {
    fetchImpl: options.fetch ?? globalThis.fetch,
    apiKey: options.apiKey ?? process.env.OPENROUTER_API_KEY,
    now: options.now ?? Date.now,
    requestId: options.requestId ?? randomUUID,
    model: options.model ?? fallbackModel,
    sleep: options.sleep ?? delay,
    maxAttempts: Math.max(
      1,
      Math.min(MAX_ATTEMPTS, Math.trunc(options.maxAttempts ?? MAX_ATTEMPTS)),
    ),
    timeoutMs: Math.max(1, options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    signal: options.signal,
    httpReferer: options.httpReferer,
    appTitle: options.appTitle,
    allowedEndpointOrigins: options.allowedEndpointOrigins ?? [],
  };
}

/**
 * The native OpenRouter Decisions adapter. Posts `{model, state, questions}`
 * to `/api/alpha/decisions` and preserves native distributions, the resolved
 * model, usage, and cost. Never mutates a target and returns a durable
 * invalid/unavailable record instead of making model output a control-flow
 * dependency.
 */
export function createOpenRouterDecisionProvider(
  options: OpenRouterDecisionProviderOptions = {},
): ModelDecisionProvider {
  const runtime = sharedRuntime(
    options,
    process.env.OPENROUTER_DECISION_MODEL ?? DEFAULT_OPENROUTER_DECISION_MODEL,
  );
  const endpoint = options.endpoint ?? OPENROUTER_DECISIONS_ENDPOINT;
  return {
    id: "openrouter",
    async decide(request) {
      const id = runtime.requestId();
      const startedAt = runtime.now();
      const invalidRequest = requestError(request);
      if (invalidRequest) {
        return {
          ...recordBase(request, id, startedAt, runtime.now(), "native-distribution"),
          status: "invalid",
          model: request.model || runtime.model,
          error: { code: "request-rejected", message: invalidRequest },
        };
      }
      if (!runtime.apiKey || !runtime.fetchImpl) {
        return {
          ...recordBase(request, id, startedAt, runtime.now(), "native-distribution"),
          status: "unavailable",
          model: request.model || runtime.model,
          error: { code: "provider-unavailable", message: "OpenRouter is not configured" },
        };
      }
      const egressBlocked = modelEgressBlockedReason(endpoint, runtime.allowedEndpointOrigins);
      if (egressBlocked) {
        return {
          ...recordBase(request, id, startedAt, runtime.now(), "native-distribution"),
          status: "unavailable",
          model: request.model || runtime.model,
          error: { code: "provider-unavailable", message: egressBlocked },
        };
      }
      if (runtime.signal?.aborted) {
        return {
          ...recordBase(request, id, startedAt, runtime.now(), "native-distribution"),
          status: "unavailable",
          model: request.model || runtime.model,
          error: { code: "provider-unavailable", message: "Decision request was cancelled." },
        };
      }

      const safeState = redactSensitiveEvidenceValue(request.state) as ModelDecisionJson;
      const safeQuestions = redactSensitiveEvidenceValue(request.questions) as Record<
        string,
        ModelDecisionQuestion
      >;
      // Official Decisions wire shape: {model, state, questions} — no chat
      // envelope, no response_format, no generated JSON.
      const body = {
        model: request.model || runtime.model,
        state: safeState,
        questions: safeQuestions,
      };
      const outcome = await postWithRetry(runtime, endpoint, body);
      const completedAt = runtime.now();

      if (!outcome.ok) {
        if (outcome.aborted) {
          return {
            ...recordBase(request, id, startedAt, completedAt, "native-distribution"),
            status: "unavailable",
            model: body.model,
            error: {
              code: "provider-unavailable",
              message: runtime.signal?.aborted
                ? "Decision request was cancelled."
                : `Decision request exceeded its ${runtime.timeoutMs}ms deadline.`,
            },
          };
        }
        const rejected = outcome.status >= 400 && outcome.status < 500;
        return {
          ...recordBase(request, id, startedAt, completedAt, "native-distribution"),
          status: rejected ? "invalid" : "unavailable",
          model: body.model,
          error: {
            code: rejected ? "request-rejected" : "provider-unavailable",
            message: `${outcome.retryable ? "OpenRouter Decisions remained unavailable" : "OpenRouter Decisions rejected the request"}: ${errorMessage(outcome.body, outcome.status)}`,
          },
        };
      }

      const native = outcome.body as unknown as NativeDecisionsResponse;
      const usage = usageFromTokens(
        native.usage?.input_tokens,
        native.usage?.output_tokens,
        native.usage?.cost,
      );
      const validated = validateAnswers(native, request.questions, "native");
      if ("error" in validated) {
        return {
          ...recordBase(request, id, startedAt, completedAt, "native-distribution"),
          status: "invalid",
          // The exact evaluated model is pinned from the response; alias
          // resolution stays in the record for every decision.
          model: typeof native.model === "string" && native.model ? native.model : body.model,
          ...(usage ? { usage } : {}),
          error: { code: "invalid-response", message: validated.error },
        };
      }
      return {
        ...recordBase(request, id, startedAt, completedAt, "native-distribution"),
        status: "ok",
        model: typeof native.model === "string" && native.model ? native.model : body.model,
        answers: validated.answers,
        ...(usage ? { usage } : {}),
      };
    },
  };
}

/**
 * The structured-generation adapter for a configured general chat model. It
 * keeps the strict self-reported contract (full distribution summing to one)
 * and marks its uncertainty as self-reported — never a native distribution.
 */
export function createOpenRouterStructuredGenerationProvider(
  options: OpenRouterDecisionProviderOptions = {},
): ModelDecisionProvider {
  const runtime = sharedRuntime(options, process.env.OPENROUTER_MODEL ?? "openai/gpt-4o-mini");
  const endpoint = options.endpoint ?? OPENROUTER_CHAT_COMPLETIONS_ENDPOINT;
  return {
    id: "openrouter",
    async decide(request) {
      const id = runtime.requestId();
      const startedAt = runtime.now();
      const invalidRequest = requestError(request);
      if (invalidRequest) {
        return {
          ...recordBase(request, id, startedAt, runtime.now(), "self-reported"),
          status: "invalid",
          model: request.model || runtime.model,
          error: { code: "request-rejected", message: invalidRequest },
        };
      }
      if (!runtime.apiKey || !runtime.fetchImpl) {
        return {
          ...recordBase(request, id, startedAt, runtime.now(), "self-reported"),
          status: "unavailable",
          model: request.model || runtime.model,
          error: { code: "provider-unavailable", message: "OpenRouter is not configured" },
        };
      }
      const egressBlocked = modelEgressBlockedReason(endpoint, runtime.allowedEndpointOrigins);
      if (egressBlocked) {
        return {
          ...recordBase(request, id, startedAt, runtime.now(), "self-reported"),
          status: "unavailable",
          model: request.model || runtime.model,
          error: { code: "provider-unavailable", message: egressBlocked },
        };
      }
      if (runtime.signal?.aborted) {
        return {
          ...recordBase(request, id, startedAt, runtime.now(), "self-reported"),
          status: "unavailable",
          model: request.model || runtime.model,
          error: { code: "provider-unavailable", message: "Decision request was cancelled." },
        };
      }

      const safeState = redactSensitiveEvidenceValue(request.state) as ModelDecisionJson;
      const safeQuestions = redactSensitiveEvidenceValue(request.questions) as Record<
        string,
        ModelDecisionQuestion
      >;
      const body = {
        model: request.model || runtime.model,
        messages: [
          {
            role: "user",
            content: JSON.stringify({ state: safeState, questions: safeQuestions }),
          },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "relay_model_decision",
            strict: true,
            schema: responseSchema(request.questions),
          },
        },
        usage: { include: true },
      };
      const outcome = await postWithRetry(runtime, endpoint, body);
      const completedAt = runtime.now();

      if (!outcome.ok) {
        if (outcome.aborted) {
          return {
            ...recordBase(request, id, startedAt, completedAt, "self-reported"),
            status: "unavailable",
            model: body.model,
            error: {
              code: "provider-unavailable",
              message: runtime.signal?.aborted
                ? "Decision request was cancelled."
                : `Decision request exceeded its ${runtime.timeoutMs}ms deadline.`,
            },
          };
        }
        const rejected = outcome.status >= 400 && outcome.status < 500;
        return {
          ...recordBase(request, id, startedAt, completedAt, "self-reported"),
          status: rejected ? "invalid" : "unavailable",
          model: body.model,
          error: {
            code: rejected ? "request-rejected" : "provider-unavailable",
            message: `${outcome.retryable ? "OpenRouter remained unavailable" : "OpenRouter rejected the request"}: ${errorMessage(outcome.body, outcome.status)}`,
          },
        };
      }

      const chat = outcome.body as unknown as ChatCompletionsResponse;
      const usage = usageFromTokens(
        chat.usage?.input_tokens ?? chat.usage?.prompt_tokens,
        chat.usage?.output_tokens ?? chat.usage?.completion_tokens,
        chat.usage?.cost,
      );
      const rawContent = chat.choices?.[0]?.message?.content;
      const parsed = parseContent(rawContent);
      const validated = validateAnswers(parsed, request.questions, "self-reported");
      if ("error" in validated) {
        return {
          ...recordBase(request, id, startedAt, completedAt, "self-reported"),
          status: "invalid",
          model: typeof chat.model === "string" && chat.model ? chat.model : body.model,
          ...(usage ? { usage } : {}),
          error: { code: "invalid-response", message: validated.error },
        };
      }
      return {
        ...recordBase(request, id, startedAt, completedAt, "self-reported"),
        status: "ok",
        model: typeof chat.model === "string" && chat.model ? chat.model : body.model,
        answers: validated.answers,
        ...(usage ? { usage } : {}),
      };
    },
  };
}

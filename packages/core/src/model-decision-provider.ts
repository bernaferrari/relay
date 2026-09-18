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
import { redactSensitiveEvidenceValue } from "./redaction.js";

const OPENROUTER_CHAT_COMPLETIONS = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_MODEL = "~typesafe/jev-latest";
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
};

export type ModelDecisionProvider = {
  id: "openrouter";
  decide(request: ModelDecisionRequest): Promise<ModelDecisionRecord>;
};

type OpenRouterResponse = {
  id?: unknown;
  model?: unknown;
  choices?: Array<{
    message?: { content?: unknown };
  }>;
  usage?: {
    input_tokens?: unknown;
    output_tokens?: unknown;
    prompt_tokens?: unknown;
    completion_tokens?: unknown;
  };
  error?: { message?: unknown };
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

function responseUsage(
  body: OpenRouterResponse,
): { inputTokens: number; outputTokens: number } | undefined {
  if (!body.usage) return undefined;
  const input = finiteNumber(body.usage.input_tokens ?? body.usage.prompt_tokens, 0);
  const output = finiteNumber(body.usage.output_tokens ?? body.usage.completion_tokens, 0);
  return input !== null && output !== null
    ? { inputTokens: Math.trunc(input), outputTokens: Math.trunc(output) }
    : undefined;
}

function errorMessage(body: OpenRouterResponse, status: number): string {
  return typeof body.error?.message === "string"
    ? body.error.message
    : `OpenRouter returned HTTP ${status}`;
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
  const model = options.model ?? process.env.OPENROUTER_DECISION_MODEL ?? DEFAULT_MODEL;
  const endpoint = options.endpoint ?? OPENROUTER_CHAT_COMPLETIONS;
  const maxAttempts = Math.max(
    1,
    Math.min(MAX_ATTEMPTS, Math.trunc(options.maxAttempts ?? MAX_ATTEMPTS)),
  );

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

      const safeState = redactSensitiveEvidenceValue(request.state) as ModelDecisionJson;
      const safeQuestions = redactSensitiveEvidenceValue(request.questions) as Record<
        string,
        ModelDecisionQuestion
      >;
      const body = {
        model: request.model || model,
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
      let response: Response | undefined;
      let responseBody: OpenRouterResponse = {};
      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        try {
          response = await fetchImpl(endpoint, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${apiKey}`,
              "Content-Type": "application/json",
              ...(options.httpReferer ? { "HTTP-Referer": options.httpReferer } : {}),
              ...(options.appTitle ? { "X-Title": options.appTitle } : {}),
            },
            body: JSON.stringify(body),
          });
          responseBody = (await response.json().catch(() => ({}))) as OpenRouterResponse;
        } catch (error) {
          const completedAt = now();
          return {
            ...recordBase(request, id, startedAt, completedAt),
            status: "unavailable",
            model: body.model,
            error: {
              code: "provider-unavailable",
              message: error instanceof Error ? error.message : "OpenRouter request failed",
            },
          };
        }
        if (response.ok || !RETRYABLE_STATUSES.has(response.status) || attempt === maxAttempts)
          break;
        await sleep(250 * 2 ** (attempt - 1));
      }

      const completedAt = now();
      if (!response?.ok) {
        const retryable = response ? RETRYABLE_STATUSES.has(response.status) : true;
        const rejected = Boolean(response && response.status >= 400 && response.status < 500);
        return {
          ...recordBase(request, id, startedAt, completedAt),
          status: rejected ? "invalid" : "unavailable",
          model: body.model,
          error: {
            code: rejected ? "request-rejected" : "provider-unavailable",
            message: `${retryable ? "OpenRouter remained unavailable" : "OpenRouter rejected the request"}: ${errorMessage(responseBody, response?.status ?? 0)}`,
          },
        };
      }

      const rawContent = responseBody.choices?.[0]?.message?.content;
      const parsed = parseContent(rawContent);
      const validated = validateAnswers(parsed, request.questions);
      if ("error" in validated) {
        return {
          ...recordBase(request, id, startedAt, completedAt),
          status: "invalid",
          model: typeof responseBody.model === "string" ? responseBody.model : body.model,
          usage: responseUsage(responseBody),
          error: { code: "invalid-response", message: validated.error },
        };
      }
      return {
        ...recordBase(request, id, startedAt, completedAt),
        status: "ok",
        model: typeof responseBody.model === "string" ? responseBody.model : body.model,
        answers: validated.answers,
        usage: responseUsage(responseBody),
      };
    },
  };
}

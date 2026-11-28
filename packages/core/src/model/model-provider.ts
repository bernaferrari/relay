/**
 * Provider selection and lazy construction for Relay's Vercel AI SDK calls.
 * Resolution is deliberately pure so precedence and model defaults can be
 * tested without touching process state or the network.
 */
import type { LanguageModel } from "ai";
import { readSavedModelKey, type SavedModelKey } from "./model-key.js";
import { createOpenRouterClient, openRouterBaseUrl } from "../openrouter/openrouter-ai-sdk.js";

export type RelayModelProvider =
  | "anthropic"
  | "openai"
  | "google"
  | "openrouter"
  | "openai-compatible";

export type RelayModelResolutionSource = "explicit" | "settings" | "environment" | "none";

export interface RelayModelResolution {
  provider: RelayModelProvider | null;
  apiKey?: string;
  baseURL?: string;
  source: RelayModelResolutionSource;
}

export type RelayModelTask =
  | "act"
  | "check"
  | "decision"
  | "draft"
  | "ground"
  | "growth"
  | "semantic"
  | "generation"
  | "vision";

export type ModelEnvironment = Record<string, string | undefined>;

const PROVIDERS = new Set<RelayModelProvider>([
  "anthropic",
  "openai",
  "google",
  "openrouter",
  "openai-compatible",
]);

const KEY_ENVIRONMENTS: Record<RelayModelProvider, readonly string[]> = {
  anthropic: ["ANTHROPIC_API_KEY"],
  openai: ["OPENAI_API_KEY"],
  google: ["GEMINI_API_KEY", "GOOGLE_GENERATIVE_AI_API_KEY"],
  openrouter: ["OPENROUTER_API_KEY"],
  "openai-compatible": [],
};

const PROVIDER_DETECTION_ORDER: readonly RelayModelProvider[] = [
  "anthropic",
  "openai",
  "google",
  "openrouter",
];

const DEFAULT_BASE_URLS: Record<Exclude<RelayModelProvider, "openai-compatible">, string> = {
  anthropic: "https://api.anthropic.com/v1",
  openai: "https://api.openai.com/v1",
  google: "https://generativelanguage.googleapis.com/v1beta",
  openrouter: "https://openrouter.ai/api/v1",
};

export const OLLAMA_BASE_URL = "http://localhost:11434/v1";

function clean(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function parseProvider(value: string | undefined): RelayModelProvider | "ollama" | undefined {
  const normalized = clean(value)?.toLowerCase();
  if (normalized === "ollama") return "ollama";
  return PROVIDERS.has(normalized as RelayModelProvider)
    ? (normalized as RelayModelProvider)
    : undefined;
}

function environmentKey(provider: RelayModelProvider, env: ModelEnvironment): string | undefined {
  for (const name of KEY_ENVIRONMENTS[provider]) {
    const value = clean(env[name]);
    if (value) return value;
  }
  return undefined;
}

/**
 * Resolve the active provider without reading process.env or the filesystem.
 * A provider-specific environment key intentionally outranks a saved key for
 * that same provider; it then participates in the normal zero-config order.
 */
export function resolveRelayModelProvider(
  env: ModelEnvironment = {},
  savedKey?: Pick<SavedModelKey, "provider" | "key" | "baseURL"> | null,
): RelayModelResolution {
  const genericKey = clean(env.RELAY_MODEL_API_KEY);
  const configuredBaseUrl = clean(env.RELAY_MODEL_BASE_URL);
  const explicit = parseProvider(env.RELAY_MODEL_PROVIDER);
  if (explicit) {
    const provider = explicit === "ollama" ? "openai-compatible" : explicit;
    const savedCompatibleBaseUrl =
      savedKey?.provider === "openai-compatible" ? clean(savedKey.baseURL) : undefined;
    const baseURL =
      provider === "openai-compatible"
        ? explicit === "ollama"
          ? (configuredBaseUrl ?? OLLAMA_BASE_URL)
          : (configuredBaseUrl ?? savedCompatibleBaseUrl)
        : undefined;
    return {
      provider,
      apiKey:
        environmentKey(provider, env) ??
        genericKey ??
        (savedKey?.provider === provider ? clean(savedKey.key) : undefined),
      baseURL,
      source: "explicit",
    };
  }

  if (
    savedKey &&
    PROVIDERS.has(savedKey.provider) &&
    clean(savedKey.key) &&
    !environmentKey(savedKey.provider, env)
  ) {
    return {
      provider: savedKey.provider,
      apiKey: clean(savedKey.key),
      baseURL:
        savedKey.provider === "openai-compatible"
          ? (configuredBaseUrl ?? clean(savedKey.baseURL))
          : undefined,
      source: "settings",
    };
  }

  for (const provider of PROVIDER_DETECTION_ORDER) {
    const apiKey = environmentKey(provider, env);
    if (apiKey) return { provider, apiKey, source: "environment" };
  }

  if (configuredBaseUrl) {
    return {
      provider: "openai-compatible",
      apiKey: genericKey,
      baseURL: configuredBaseUrl,
      source: "environment",
    };
  }
  return { provider: null, source: "none" };
}

/** Resolve using this process environment and the saved Settings key. */
export function resolveActiveRelayModelProvider(
  env: ModelEnvironment = process.env,
): RelayModelResolution {
  return resolveRelayModelProvider(env, readSavedModelKey());
}

const TASK_ENVIRONMENT_NAMES: Partial<Record<RelayModelTask, string>> = {
  act: "RELAY_ACT_MODEL",
  check: "RELAY_CHECK_MODEL",
  decision: "RELAY_DECISION_MODEL",
  draft: "RELAY_DRAFT_MODEL",
  ground: "RELAY_GROUND_MODEL",
  vision: "RELAY_VISION_MODEL",
};

const LEGACY_TASK_ENVIRONMENT_NAMES: Partial<Record<RelayModelTask, string>> = {
  act: "OPENROUTER_ACT_MODEL",
  check: "OPENROUTER_CHECK_MODEL",
  decision: "OPENROUTER_DECISION_MODEL",
  draft: "OPENROUTER_DRAFT_MODEL",
  ground: "OPENROUTER_GROUND_MODEL",
  vision: "OPENROUTER_VISION_MODEL",
};

const VISION_TASKS = new Set<RelayModelTask>(["act", "check", "vision"]);

const DEFAULT_MODELS: Record<
  Exclude<RelayModelProvider, "openai-compatible">,
  { vision: string; text: string }
> = {
  anthropic: { vision: "claude-sonnet-5-5", text: "claude-haiku-5-5" },
  openai: { vision: "gpt-5.1", text: "gpt-5-mini" },
  google: { vision: "gemini-flash-latest", text: "gemini-flash-lite-latest" },
  openrouter: { vision: "~openai/gpt-terra-latest", text: "~openai/gpt-terra-latest" },
};

/** Resolve a task model using neutral names first and legacy OpenRouter names as fallback. */
export function resolveRelayTaskModel(
  task: RelayModelTask,
  provider: RelayModelProvider,
  env: ModelEnvironment = {},
  explicitModel?: string,
): string | undefined {
  const explicit = clean(explicitModel);
  if (explicit) return explicit;
  const neutralTaskName = TASK_ENVIRONMENT_NAMES[task];
  const neutralTask = neutralTaskName ? clean(env[neutralTaskName]) : undefined;
  if (neutralTask) return neutralTask;
  const legacyTaskName = LEGACY_TASK_ENVIRONMENT_NAMES[task];
  const legacyTask = legacyTaskName ? clean(env[legacyTaskName]) : undefined;
  if (legacyTask) return legacyTask;
  // Act and Check historically shared the vision-model override with the
  // screenshot judge. Keep that broader visual fallback before generic text.
  if ((task === "act" || task === "check") && clean(env.RELAY_VISION_MODEL)) {
    return clean(env.RELAY_VISION_MODEL);
  }
  if ((task === "act" || task === "check") && clean(env.OPENROUTER_VISION_MODEL)) {
    return clean(env.OPENROUTER_VISION_MODEL);
  }
  const neutralGeneric = clean(env.RELAY_MODEL);
  if (neutralGeneric) return neutralGeneric;
  const legacyGeneric = clean(env.OPENROUTER_MODEL);
  if (legacyGeneric) return legacyGeneric;
  if (provider === "openai-compatible") return undefined;
  const taskDefault = PROVIDER_TASK_DEFAULTS[provider]?.[task];
  if (taskDefault) return taskDefault;
  return VISION_TASKS.has(task) ? DEFAULT_MODELS[provider].vision : DEFAULT_MODELS[provider].text;
}

/** Task defaults that differ from the generic text fallback. On OpenRouter,
 * decision tasks default to TypeSafe's purpose-built structured decision
 * model rather than a generic chat model. */
const PROVIDER_TASK_DEFAULTS: Partial<
  Record<RelayModelProvider, Partial<Record<RelayModelTask, string>>>
> = {
  openrouter: { decision: "~typesafe/jev-latest" },
};

export function defaultModelEgressOrigin(provider: RelayModelProvider): string | undefined {
  if (provider === "openai-compatible") return undefined;
  return new URL(DEFAULT_BASE_URLS[provider]).origin;
}

/**
 * Return a blocking reason when an endpoint is outside the active provider's
 * origin and caller-approved extras. The third parameter defaults to
 * openrouter for compatibility with the original decision-boundary tests.
 */
export function modelEgressBlockedReason(
  endpoint: string,
  allowedEndpointOrigins: readonly string[] = [],
  activeProvider: RelayModelProvider = "openrouter",
): string | undefined {
  if (process.env.RELAY_MODEL_EGRESS?.trim().toLowerCase() === "disabled") {
    return "model egress is disabled by RELAY_MODEL_EGRESS=disabled";
  }
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return "model endpoint must be a valid URL";
  }
  if (!["https:", "http:"].includes(url.protocol)) return "model endpoint must use HTTP(S)";
  if (url.protocol === "http:" && !["localhost", "127.0.0.1", "::1"].includes(url.hostname)) {
    return "plain-HTTP model endpoints are limited to localhost";
  }
  const allowed = new Set(allowedEndpointOrigins);
  const providerOrigin =
    activeProvider === "openai-compatible" ? url.origin : defaultModelEgressOrigin(activeProvider);
  if (providerOrigin) allowed.add(providerOrigin);
  if (!allowed.has(url.origin)) {
    return `model endpoint origin ${url.origin} is not in the Relay egress allowlist`;
  }
  return undefined;
}

export class ModelProviderNotConfiguredError extends Error {
  constructor(message = modelProviderNotConfiguredMessage()) {
    super(message);
    this.name = "ModelProviderNotConfiguredError";
  }
}

export function modelProviderNotConfiguredMessage(): string {
  return "No model provider is configured. Set ANTHROPIC_API_KEY, OPENAI_API_KEY, GEMINI_API_KEY, or OPENROUTER_API_KEY; save a model key in Settings; or configure RELAY_MODEL_PROVIDER.";
}

type ProviderInstance = {
  chat?: (modelId: string) => LanguageModel;
  chatModel?: (modelId: string) => LanguageModel;
};

type ProviderFactory = (settings: Record<string, unknown>) => ProviderInstance;

export interface RelayModelClient {
  sdk: {
    generateObject: typeof import("ai").generateObject;
    generateText: typeof import("ai").generateText;
    jsonSchema: typeof import("ai").jsonSchema;
    Output: typeof import("ai").Output;
  };
  provider: { chat: (modelId: string) => LanguageModel };
  providerId: RelayModelProvider;
  model: string;
  apiKey?: string;
  baseURL?: string;
  resolution: RelayModelResolution;
}

export interface RelayModelClientOptions {
  model?: string;
  apiKey?: string;
  baseURL?: string;
  endpoint?: string;
  httpReferer?: string;
  appTitle?: string;
  fetch?: typeof fetch;
  env?: ModelEnvironment;
  savedKey?: SavedModelKey | null;
  allowedEndpointOrigins?: readonly string[];
  /** Test seam: provider constructors keyed by provider id. */
  providerFactories?: Partial<Record<RelayModelProvider, ProviderFactory>>;
}

type ProviderModuleName = Exclude<RelayModelProvider, "openrouter">;

async function defaultProviderFactory(provider: ProviderModuleName): Promise<ProviderFactory> {
  switch (provider) {
    case "anthropic": {
      const module = await import("@ai-sdk/anthropic");
      return module.createAnthropic as unknown as ProviderFactory;
    }
    case "openai": {
      const module = await import("@ai-sdk/openai");
      return module.createOpenAI as unknown as ProviderFactory;
    }
    case "google": {
      const module = await import("@ai-sdk/google");
      return module.createGoogleGenerativeAI as unknown as ProviderFactory;
    }
    case "openai-compatible": {
      const module = await import("@ai-sdk/openai-compatible");
      return module.createOpenAICompatible as unknown as ProviderFactory;
    }
  }
}

function missingModelMessage(provider: RelayModelProvider, task: RelayModelTask): string {
  const taskVariable = TASK_ENVIRONMENT_NAMES[task];
  const taskText = taskVariable ? `${taskVariable} or ` : "";
  return `No ${provider} model is configured for ${task}. Set ${taskText}RELAY_MODEL; openai-compatible providers do not have a built-in default model.`;
}

/** Create a normalized chat-model client without loading unused provider SDKs. */
export async function createModelClient(
  task: RelayModelTask,
  options: RelayModelClientOptions = {},
): Promise<RelayModelClient> {
  const env = options.env ?? process.env;
  const savedKey = options.savedKey === undefined ? readSavedModelKey() : options.savedKey;
  const resolved = resolveRelayModelProvider(env, savedKey);
  const resolution: RelayModelResolution = resolved.provider
    ? {
        ...resolved,
        apiKey: options.apiKey ?? resolved.apiKey,
        baseURL: options.baseURL ?? resolved.baseURL,
      }
    : options.apiKey
      ? // Compatibility for legacy callers that only knew how to pass an OpenRouter key.
        { provider: "openrouter", apiKey: options.apiKey, source: "explicit" }
      : options.baseURL
        ? {
            provider: "openai-compatible",
            apiKey: options.apiKey,
            baseURL: options.baseURL,
            source: "explicit",
          }
        : resolved;
  const providerId = resolution.provider;
  if (!providerId) throw new ModelProviderNotConfiguredError();
  const apiKey = options.apiKey ?? resolution.apiKey;
  if (providerId !== "openai-compatible" && !apiKey) {
    throw new ModelProviderNotConfiguredError(
      `No API key is configured for the ${providerId} model provider.`,
    );
  }
  const model = resolveRelayTaskModel(task, providerId, env, options.model);
  if (!model) throw new ModelProviderNotConfiguredError(missingModelMessage(providerId, task));

  if (providerId === "openrouter") {
    const endpoint = options.endpoint ?? "https://openrouter.ai/api/v1/chat/completions";
    const blocked = modelEgressBlockedReason(endpoint, options.allowedEndpointOrigins, providerId);
    if (blocked) throw new Error(blocked);
    const client = await createOpenRouterClient({
      apiKey: apiKey ?? "",
      endpoint,
      httpReferer: options.httpReferer,
      appTitle: options.appTitle,
      fetch: options.fetch,
    });
    return {
      sdk: client.sdk,
      provider: { chat: (modelId) => client.provider.chat(modelId) as LanguageModel },
      providerId,
      model,
      apiKey,
      baseURL: openRouterBaseUrl(endpoint),
      resolution: { ...resolution, apiKey },
    };
  }

  const baseURL =
    options.baseURL ??
    resolution.baseURL ??
    (providerId === "openai-compatible" ? undefined : DEFAULT_BASE_URLS[providerId]);
  if (!baseURL) {
    throw new ModelProviderNotConfiguredError(
      "No base URL is configured for the openai-compatible model provider. Set RELAY_MODEL_BASE_URL.",
    );
  }
  const blocked = modelEgressBlockedReason(baseURL, options.allowedEndpointOrigins, providerId);
  if (blocked) throw new Error(blocked);
  const [ai, factory] = await Promise.all([
    import("ai"),
    options.providerFactories?.[providerId]
      ? Promise.resolve(options.providerFactories[providerId])
      : defaultProviderFactory(providerId),
  ]);
  const settings: Record<string, unknown> = { apiKey, baseURL, fetch: options.fetch };
  if (providerId === "openai-compatible") {
    settings.name = "relay-openai-compatible";
    settings.supportsStructuredOutputs = true;
  }
  const instance = factory?.(settings);
  const chat = instance?.chat ?? instance?.chatModel;
  if (!instance || !chat) {
    throw new Error(`The ${providerId} provider SDK did not expose a chat model factory.`);
  }
  return {
    sdk: {
      generateObject: ai.generateObject,
      generateText: ai.generateText,
      jsonSchema: ai.jsonSchema,
      Output: ai.Output,
    },
    provider: { chat: (modelId) => chat.call(instance, modelId) },
    providerId,
    model,
    apiKey,
    baseURL,
    resolution: { ...resolution, apiKey, baseURL },
  };
}

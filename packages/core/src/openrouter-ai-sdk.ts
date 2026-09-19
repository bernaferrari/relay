export const OPENROUTER_CHAT_COMPLETIONS = "https://openrouter.ai/api/v1/chat/completions";

export type OpenRouterAiSdk = {
  generateObject: typeof import("ai").generateObject;
  generateText: typeof import("ai").generateText;
  jsonSchema: typeof import("ai").jsonSchema;
  Output: typeof import("ai").Output;
  createOpenRouter: typeof import("@openrouter/ai-sdk-provider").createOpenRouter;
};

export type OpenRouterAiSdkOptions = {
  apiKey: string;
  endpoint?: string;
  httpReferer?: string;
  appTitle?: string;
  fetch?: typeof globalThis.fetch;
};

export type OpenRouterClient = {
  sdk: OpenRouterAiSdk;
  provider: ReturnType<OpenRouterAiSdk["createOpenRouter"]>;
};

let sdkPromise: Promise<OpenRouterAiSdk> | undefined;

export function openRouterBaseUrl(endpoint = OPENROUTER_CHAT_COMPLETIONS): string {
  return endpoint.replace(/\/chat\/completions\/?$/u, "");
}

export async function loadOpenRouterAiSdk(): Promise<OpenRouterAiSdk> {
  sdkPromise ??= Promise.all([import("ai"), import("@openrouter/ai-sdk-provider")]).then(
    ([{ generateObject, generateText, jsonSchema, Output }, { createOpenRouter }]) => ({
      generateObject,
      generateText,
      jsonSchema,
      Output,
      createOpenRouter,
    }),
  );
  return sdkPromise;
}

export async function createOpenRouterClient(
  options: OpenRouterAiSdkOptions,
): Promise<OpenRouterClient> {
  const sdk = await loadOpenRouterAiSdk();
  const provider = sdk.createOpenRouter({
    apiKey: options.apiKey,
    baseURL: openRouterBaseUrl(options.endpoint),
    ...(options.fetch ? { fetch: options.fetch } : {}),
    ...(options.httpReferer || options.appTitle
      ? {
          headers: {
            ...(options.httpReferer ? { "HTTP-Referer": options.httpReferer } : {}),
            ...(options.appTitle ? { "X-Title": options.appTitle } : {}),
          },
        }
      : {}),
    compatibility: "strict",
  });
  return { sdk, provider };
}

/** Extract OpenRouter's optional usage-accounting cost from AI SDK metadata. */
export function openRouterCostUsd(metadata: unknown): number | undefined {
  if (!metadata || typeof metadata !== "object") return undefined;
  const root = metadata as Record<string, unknown>;
  const openrouter = root.openrouter;
  const usage =
    openrouter && typeof openrouter === "object"
      ? (openrouter as Record<string, unknown>).usage
      : undefined;
  if (!usage || typeof usage !== "object") return undefined;
  const cost = (usage as Record<string, unknown>).cost;
  return typeof cost === "number" && Number.isFinite(cost) && cost >= 0 ? cost : undefined;
}

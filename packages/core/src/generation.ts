import { createHash, randomUUID } from "node:crypto";
import type { GenerationRequest, GenerationResult, GenerationUsage } from "@relay/protocol";
import { z } from "zod";
import { createOpenRouterClient, openRouterCostUsd } from "./openrouter-ai-sdk.js";

export type GenerationProvider = {
  id: string;
  generate(input: GenerationRequest): Promise<GenerationResult>;
};

const providers = new Map<string, GenerationProvider>();

export function registerGenerationProvider(provider: GenerationProvider): () => void {
  providers.set(provider.id, provider);
  return () => providers.delete(provider.id);
}

function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => (state = (state * 1664525 + 1013904223) >>> 0) / 0x100000000;
}

export const deterministicGenerationProvider: GenerationProvider = {
  id: "deterministic",
  async generate(input) {
    if (input.purpose === "test-plan") {
      return {
        provider: "deterministic",
        model: "planner-pass-through-v1",
        values: [input.allowedValues?.[0] ?? input.prompt],
        generatedAt: Date.now(),
      };
    }
    const count = Math.max(1, Math.min(input.count ?? 1, 20));
    const random = seeded(input.seed ?? 1);
    const variants = ["concise", "detailed", "friendly", "formal", "edge-case", "multilingual"];
    return {
      provider: "deterministic",
      model: "fixture-v1",
      values: Array.from(
        { length: count },
        (_, index) =>
          `${input.prompt} [${variants[Math.floor(random() * variants.length)]} ${index + 1}]`,
      ),
      generatedAt: Date.now(),
    };
  },
};

registerGenerationProvider(deterministicGenerationProvider);

function parseValues(text: string, count: number): string[] {
  try {
    const value = JSON.parse(text) as unknown;
    if (Array.isArray(value)) return value.map(String).slice(0, count);
    if (value && typeof value === "object" && "values" in value) {
      const values = (value as { values?: unknown }).values;
      if (Array.isArray(values)) return values.map(String).slice(0, count);
    }
  } catch {
    /* accept newline-delimited provider output */
  }
  return text
    .split("\n")
    .map((line) => line.replace(/^[-*\d.)\s]+/, "").trim())
    .filter(Boolean)
    .slice(0, count);
}

function generationPrompt(input: GenerationRequest): string {
  const count = Math.max(1, Math.min(input.count ?? 1, 20));
  if (input.purpose === "test-plan") {
    return `${input.prompt}\nReturn only JSON {"values":[...]} with at most ${count} value(s).`;
  }
  return `Generate ${count} varied test value(s) for this request: ${input.prompt}. Return only JSON {"values":[...]}.`;
}

export function createOpenRouterGenerationProvider(
  apiKey: string,
  options: {
    model?: string;
    siteUrl?: string;
    siteName?: string;
    fetch?: typeof globalThis.fetch;
  } = {},
): GenerationProvider {
  return {
    id: "openrouter",
    async generate(input) {
      const model = input.model ?? options.model ?? "openai/gpt-4.1-mini";
      const { sdk, provider } = await createOpenRouterClient({
        apiKey,
        fetch: options.fetch,
        httpReferer: options.siteUrl,
        appTitle: options.siteName ?? "Relay",
      });
      const generated = await sdk.generateObject({
        model: provider.chat(model),
        prompt: generationPrompt(input),
        schema: z.object({ values: z.array(z.string()) }),
        schemaName: "relay_generation_values",
        temperature: input.purpose === "test-plan" ? 0.1 : 0.7,
        maxRetries: 0,
      });
      const values = generated.object.values.map(String).slice(0, input.count ?? 1);
      const costUsd = openRouterCostUsd(generated.providerMetadata);
      return {
        provider: "openrouter",
        model: generated.response.modelId || model,
        values,
        generatedAt: Date.now(),
        usage: {
          inputTokens: generated.usage.inputTokens,
          outputTokens: generated.usage.outputTokens,
          totalTokens: generated.usage.totalTokens,
          ...(costUsd === undefined ? {} : { costUsd }),
        },
      };
    },
  };
}

function registerBuiltins(): void {
  const openRouterKey = process.env.OPENROUTER_API_KEY;
  if (openRouterKey) {
    registerGenerationProvider(
      createOpenRouterGenerationProvider(openRouterKey, {
        model: process.env.OPENROUTER_MODEL,
        siteUrl: process.env.OPENROUTER_SITE_URL,
        siteName: process.env.OPENROUTER_SITE_NAME ?? "Relay",
      }),
    );
  }

  const localUrl = process.env.RELAY_LOCAL_GENERATION_URL;
  if (localUrl) {
    registerGenerationProvider({
      id: "local",
      async generate(input) {
        const model = input.model ?? "local";
        const response = await fetch(localUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...input, prompt: generationPrompt(input) }),
        });
        if (!response.ok) throw new Error(`Local generation failed (${response.status})`);
        const body = (await response.json()) as { values?: unknown[]; text?: string };
        const values = body.values?.map(String) ?? parseValues(body.text ?? "", input.count ?? 1);
        return { provider: "local", model, values, generatedAt: Date.now() };
      },
    });
  }
}

registerBuiltins();

export async function generateValues(input: GenerationRequest): Promise<GenerationResult> {
  const providerId = input.provider ?? process.env.RELAY_GENERATION_PROVIDER ?? "deterministic";
  const provider = providers.get(providerId);
  if (!provider) throw new Error(`Generation provider is not configured: ${providerId}`);
  const startedAt = Date.now();
  const result = await provider.generate(input);
  const completedAt = Date.now();
  const usage = compactUsage(result.usage);
  const allowed = input.allowedValues ? new Set(input.allowedValues) : undefined;
  const values = allowed ? result.values.filter((value) => allowed.has(value)) : result.values;
  return {
    ...result,
    values,
    ...(usage ? { usage } : {}),
    provenance: {
      requestId: randomUUID(),
      purpose: input.purpose,
      promptDigest: createHash("sha256").update(input.prompt).digest("hex"),
      startedAt,
      completedAt,
      durationMs: Math.max(0, completedAt - startedAt),
      ...(input.seed !== undefined ? { seed: input.seed } : {}),
      ...(usage ? { usage } : {}),
    },
  };
}

function compactUsage(usage: GenerationUsage | undefined): GenerationUsage | undefined {
  if (!usage) return undefined;
  const entries = Object.entries(usage).filter(([, value]) => value !== undefined);
  return entries.length ? (Object.fromEntries(entries) as GenerationUsage) : undefined;
}

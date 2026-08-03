import { createHash, randomUUID } from "node:crypto";
import type { GenerationRequest, GenerationResult, GenerationUsage } from "@relay/protocol";

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
        values: [input.prompt],
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
  options: { model?: string; siteUrl?: string; siteName?: string } = {},
): GenerationProvider {
  return {
    id: "openrouter",
    async generate(input) {
      const model = input.model ?? options.model ?? "openai/gpt-4.1-mini";
      const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          ...(options.siteUrl ? { "HTTP-Referer": options.siteUrl } : {}),
          ...(options.siteName ? { "X-Title": options.siteName } : {}),
        },
        body: JSON.stringify({
          model,
          messages: [{ role: "user", content: generationPrompt(input) }],
          temperature: input.purpose === "test-plan" ? 0.1 : 0.7,
          response_format: { type: "json_object" },
        }),
      });
      if (!response.ok) {
        const detail = (await response.text()).slice(0, 240).trim();
        throw new Error(
          `OpenRouter generation failed (${response.status})${detail ? `: ${detail}` : ""}`,
        );
      }
      const body = (await response.json()) as {
        id?: string;
        choices?: Array<{ message?: { content?: string | null } }>;
        usage?: {
          prompt_tokens?: number;
          completion_tokens?: number;
          total_tokens?: number;
          cost?: number;
        };
      };
      const text = body.choices?.[0]?.message?.content ?? "";
      return {
        provider: "openrouter",
        model,
        values: parseValues(text, input.count ?? 1),
        generatedAt: Date.now(),
        usage: {
          inputTokens: body.usage?.prompt_tokens,
          outputTokens: body.usage?.completion_tokens,
          totalTokens: body.usage?.total_tokens,
          costUsd: body.usage?.cost,
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

  const openAiKey = process.env.OPENAI_API_KEY;
  if (openAiKey) {
    registerGenerationProvider({
      id: "openai",
      async generate(input) {
        const model = input.model ?? process.env.OPENAI_MODEL ?? "gpt-4.1-mini";
        const response = await fetch("https://api.openai.com/v1/responses", {
          method: "POST",
          headers: { Authorization: `Bearer ${openAiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({ model, input: generationPrompt(input) }),
        });
        if (!response.ok) throw new Error(`OpenAI generation failed (${response.status})`);
        const body = (await response.json()) as {
          output_text?: string;
          output?: { content?: { text?: string }[] }[];
          usage?: { input_tokens?: number; output_tokens?: number; total_tokens?: number };
        };
        const text =
          body.output_text ??
          body.output
            ?.flatMap((item) => item.content ?? [])
            .map((item) => item.text ?? "")
            .join("\n") ??
          "";
        return {
          provider: "openai",
          model,
          values: parseValues(text, input.count ?? 1),
          generatedAt: Date.now(),
          usage: {
            inputTokens: body.usage?.input_tokens,
            outputTokens: body.usage?.output_tokens,
            totalTokens: body.usage?.total_tokens,
          },
        };
      },
    });
  }

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (anthropicKey) {
    registerGenerationProvider({
      id: "anthropic",
      async generate(input) {
        const model = input.model ?? process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-20250514";
        const response = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "x-api-key": anthropicKey,
            "anthropic-version": "2023-06-01",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model,
            max_tokens: 1000,
            messages: [{ role: "user", content: generationPrompt(input) }],
          }),
        });
        if (!response.ok) throw new Error(`Anthropic generation failed (${response.status})`);
        const body = (await response.json()) as {
          content?: { text?: string }[];
          usage?: { input_tokens?: number; output_tokens?: number };
        };
        return {
          provider: "anthropic",
          model,
          values: parseValues(
            body.content?.map((item) => item.text ?? "").join("\n") ?? "",
            input.count ?? 1,
          ),
          generatedAt: Date.now(),
          usage: {
            inputTokens: body.usage?.input_tokens,
            outputTokens: body.usage?.output_tokens,
            totalTokens:
              body.usage?.input_tokens !== undefined && body.usage.output_tokens !== undefined
                ? body.usage.input_tokens + body.usage.output_tokens
                : undefined,
          },
        };
      },
    });
  }

  const googleKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY ?? process.env.GEMINI_API_KEY;
  if (googleKey) {
    registerGenerationProvider({
      id: "google",
      async generate(input) {
        const model = input.model ?? process.env.GOOGLE_GENERATIVE_AI_MODEL ?? "gemini-2.0-flash";
        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(googleKey)}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ contents: [{ parts: [{ text: generationPrompt(input) }] }] }),
          },
        );
        if (!response.ok) throw new Error(`Google generation failed (${response.status})`);
        const body = (await response.json()) as {
          candidates?: { content?: { parts?: { text?: string }[] } }[];
          usageMetadata?: {
            promptTokenCount?: number;
            candidatesTokenCount?: number;
            totalTokenCount?: number;
          };
        };
        const text =
          body.candidates
            ?.flatMap((item) => item.content?.parts ?? [])
            .map((item) => item.text ?? "")
            .join("\n") ?? "";
        return {
          provider: "google",
          model,
          values: parseValues(text, input.count ?? 1),
          generatedAt: Date.now(),
          usage: {
            inputTokens: body.usageMetadata?.promptTokenCount,
            outputTokens: body.usageMetadata?.candidatesTokenCount,
            totalTokens: body.usageMetadata?.totalTokenCount,
          },
        };
      },
    });
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
  return {
    ...result,
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

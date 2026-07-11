import type { GenerationRequest, GenerationResult } from "@relay/protocol";

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
  return `Generate ${count} varied test value(s) for this request: ${input.prompt}. Return only JSON {"values":[...]}.`;
}

function registerBuiltins(): void {
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
        const body = (await response.json()) as { content?: { text?: string }[] };
        return {
          provider: "anthropic",
          model,
          values: parseValues(
            body.content?.map((item) => item.text ?? "").join("\n") ?? "",
            input.count ?? 1,
          ),
          generatedAt: Date.now(),
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
        };
      },
    });
  }

  const localUrl =
    process.env.RELAY_LOCAL_GENERATION_URL ?? process.env.GROK_DEVICE_LOCAL_GENERATION_URL;
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
  const providerId =
    input.provider ??
    process.env.RELAY_GENERATION_PROVIDER ??
    process.env.GROK_DEVICE_GENERATION_PROVIDER ??
    "deterministic";
  const provider = providers.get(providerId);
  if (!provider) throw new Error(`Generation provider is not configured: ${providerId}`);
  return provider.generate(input);
}

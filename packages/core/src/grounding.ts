/**
 * Resolve a natural-language or structured target into an InteractInput.
 * Order: InteractInput passthrough → unique a11y → heuristics → optional vision.
 */
import { z } from "zod";
import type { SnapshotNode } from "./device.js";
import { profileHeaderAffordances } from "./discovery-semantic-tap.js";
import { captureScreenshot, captureSnapshot } from "./workspace-capture.js";
import { interact, type InteractInput } from "./workspace-interact.js";

export type GroundingMethod = "a11y" | "heuristic" | "vision";

export type GroundingCandidate = {
  label?: string;
  identifier?: string;
  point?: { x: number; y: number };
  reason?: string;
};

export type GroundingResult = {
  interaction: InteractInput;
  method: GroundingMethod;
  confidence: number;
  candidates?: GroundingCandidate[];
};

export class GroundingError extends Error {
  readonly candidates: GroundingCandidate[];
  readonly code = "grounding_failed" as const;

  constructor(message: string, candidates: GroundingCandidate[] = []) {
    super(message);
    this.name = "GroundingError";
    this.candidates = candidates;
  }

  toJSON(): Record<string, unknown> {
    return {
      ok: false,
      code: this.code,
      error: this.message,
      candidates: this.candidates,
    };
  }
}

export type VisionGroundRequest = {
  target: string;
  screenshotBase64: string;
  mime?: string;
  candidates: GroundingCandidate[];
};

export type VisionGroundHit = {
  interaction: InteractInput;
  confidence: number;
};

/** Swappable vision / NL provider used after a11y + heuristics miss. */
export interface Grounder {
  groundVision(request: VisionGroundRequest): Promise<VisionGroundHit | null>;
}

/** No-op when OpenRouter keys are absent — never crashes the control path. */
export class StubVisionGrounder implements Grounder {
  async groundVision(_request: VisionGroundRequest): Promise<VisionGroundHit | null> {
    return null;
  }
}

const visionSchema = z.object({
  kind: z.enum(["label", "identifier", "point"]),
  label: z.string().min(1).optional(),
  identifier: z.string().min(1).optional(),
  x: z.number().optional(),
  y: z.number().optional(),
  confidence: z.number().min(0).max(1).optional(),
});

export type OpenRouterVisionGrounderOptions = {
  apiKey: string;
  model?: string;
  siteUrl?: string;
  siteName?: string;
};

/**
 * Vision grounding via Vercel AI SDK + OpenRouter.
 * Construct only when OPENROUTER_API_KEY (or an explicit key) is present.
 */
export class OpenRouterVisionGrounder implements Grounder {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly siteUrl?: string;
  private readonly siteName?: string;

  constructor(options: OpenRouterVisionGrounderOptions) {
    this.apiKey = options.apiKey;
    this.model = options.model ?? process.env.OPENROUTER_GROUND_MODEL ?? "google/gemini-2.0-flash";
    this.siteUrl = options.siteUrl ?? process.env.OPENROUTER_SITE_URL;
    this.siteName = options.siteName ?? process.env.OPENROUTER_SITE_NAME ?? "Relay";
  }

  async groundVision(request: VisionGroundRequest): Promise<VisionGroundHit | null> {
    try {
      const { generateObject } = await import("ai");
      const { createOpenRouter } = await import("@openrouter/ai-sdk-provider");
      const openrouter = createOpenRouter({ apiKey: this.apiKey });
      const candidateLines = request.candidates
        .slice(0, 40)
        .map((item, index) => {
          const bits = [
            item.label ? `label=${item.label}` : "",
            item.identifier ? `id=${item.identifier}` : "",
            item.point ? `point=${item.point.x},${item.point.y}` : "",
          ].filter(Boolean);
          return `${index + 1}. ${bits.join(" ") || "(unnamed)"}`;
        })
        .join("\n");
      const mime = request.mime ?? "image/png";
      const { object } = await generateObject({
        model: openrouter(this.model),
        schema: visionSchema,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: [
                  `Find the on-screen control for: ${JSON.stringify(request.target)}.`,
                  "Prefer an existing accessibility label or identifier from the candidate list.",
                  "Only use kind=point with x,y when no label/id fits.",
                  "Return confidence 0..1.",
                  candidateLines ? `Candidates:\n${candidateLines}` : "No a11y candidates.",
                ].join("\n"),
              },
              {
                type: "image",
                image: Buffer.from(request.screenshotBase64, "base64"),
                mediaType: mime,
              },
            ],
          },
        ],
        headers: {
          ...(this.siteUrl ? { "HTTP-Referer": this.siteUrl } : {}),
          ...(this.siteName ? { "X-Title": this.siteName } : {}),
        },
      });
      const interaction = visionObjectToInteraction(object);
      if (!interaction) return null;
      return {
        interaction,
        confidence: object.confidence ?? 0.55,
      };
    } catch {
      return null;
    }
  }
}

function visionObjectToInteraction(
  object: z.infer<typeof visionSchema>,
): InteractInput | undefined {
  if (object.kind === "identifier" && object.identifier?.trim()) {
    return { kind: "identifier", identifier: object.identifier.trim() };
  }
  if (object.kind === "label" && object.label?.trim()) {
    return { kind: "label", label: object.label.trim() };
  }
  if (
    object.kind === "point" &&
    typeof object.x === "number" &&
    typeof object.y === "number" &&
    Number.isFinite(object.x) &&
    Number.isFinite(object.y)
  ) {
    return { kind: "point", x: Math.round(object.x), y: Math.round(object.y) };
  }
  return undefined;
}

export function createDefaultGrounder(env: NodeJS.ProcessEnv = process.env): Grounder {
  const apiKey = env.OPENROUTER_API_KEY?.trim();
  if (!apiKey) return new StubVisionGrounder();
  return new OpenRouterVisionGrounder({ apiKey });
}

export function isInteractInput(value: unknown): value is InteractInput {
  return (
    !!value &&
    typeof value === "object" &&
    "kind" in value &&
    typeof (value as { kind?: unknown }).kind === "string"
  );
}

export function groundingCandidates(nodes: SnapshotNode[]): GroundingCandidate[] {
  const seen = new Set<string>();
  const out: GroundingCandidate[] = [];
  const push = (candidate: GroundingCandidate) => {
    const key = `${candidate.identifier ?? ""}|${candidate.label ?? ""}|${candidate.point?.x ?? ""},${candidate.point?.y ?? ""}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(candidate);
  };
  for (const node of nodes) {
    if (node.visibleToUser === false || node.enabled === false) continue;
    const label = (node.label ?? node.value ?? "").trim();
    const identifier = node.identifier?.trim();
    if (!label && !identifier) continue;
    push({
      ...(label ? { label } : {}),
      ...(identifier ? { identifier } : {}),
      ...(node.rect
        ? {
            point: {
              x: Math.round(node.rect.x + node.rect.width / 2),
              y: Math.round(node.rect.y + node.rect.height / 2),
            },
          }
        : {}),
      reason: "a11y",
    });
  }
  for (const item of profileHeaderAffordances(nodes)) {
    push({
      label: item.label,
      ...(item.target.identifier ? { identifier: item.target.identifier } : {}),
      ...(item.target.point ? { point: item.target.point } : {}),
      reason: "heuristic",
    });
  }
  return out;
}

function matchUniqueA11y(nodes: SnapshotNode[], query: string): InteractInput | undefined {
  const needle = query.trim();
  if (!needle) return undefined;

  const byIdentifier = nodes.filter(
    (node) =>
      node.visibleToUser !== false && node.enabled !== false && node.identifier?.trim() === needle,
  );
  if (byIdentifier.length === 1) {
    return { kind: "identifier", identifier: needle };
  }

  const byLabel = nodes.filter((node) => {
    if (node.visibleToUser === false || node.enabled === false) return false;
    const label = (node.label ?? node.value ?? "").trim();
    return label === needle;
  });
  if (byLabel.length === 1) {
    const hit = byLabel[0]!;
    const identifier = hit.identifier?.trim();
    if (identifier) return { kind: "identifier", identifier };
    return { kind: "label", label: needle };
  }
  return undefined;
}

function matchHeuristic(nodes: SnapshotNode[], query: string): InteractInput | undefined {
  const needle = query.trim().toLowerCase();
  if (!needle) return undefined;
  const match = profileHeaderAffordances(nodes).find(
    (item) => item.label.trim().toLowerCase() === needle,
  );
  if (!match) return undefined;
  if (match.target.identifier?.trim()) {
    return { kind: "identifier", identifier: match.target.identifier.trim() };
  }
  if (match.target.point) {
    return {
      kind: "point",
      x: match.target.point.x,
      y: match.target.point.y,
    };
  }
  if (match.target.label?.trim()) {
    return { kind: "label", label: match.target.label.trim() };
  }
  return { kind: "label", label: match.label };
}

export type GroundTargetInput = {
  serial: string;
  target: string | InteractInput;
  screenshot?: { base64: string; mime?: string };
  nodes?: SnapshotNode[];
  grounder?: Grounder;
};

export async function groundTarget(input: GroundTargetInput): Promise<GroundingResult> {
  if (isInteractInput(input.target)) {
    return {
      interaction: input.target,
      method: "a11y",
      confidence: 1,
    };
  }

  const query = String(input.target ?? "").trim();
  if (!query) {
    throw new GroundingError("target is required (string or InteractInput)", []);
  }

  const nodes =
    input.nodes ??
    (
      await captureSnapshot({
        serial: input.serial,
      })
    ).nodes;
  const candidates = groundingCandidates(nodes);

  const a11y = matchUniqueA11y(nodes, query);
  if (a11y) {
    return {
      interaction: a11y,
      method: "a11y",
      confidence: 0.95,
      candidates,
    };
  }

  const heuristic = matchHeuristic(nodes, query);
  if (heuristic) {
    return {
      interaction: heuristic,
      method: "heuristic",
      confidence: 0.85,
      candidates,
    };
  }

  const grounder = input.grounder ?? createDefaultGrounder();
  let screenshot = input.screenshot;
  if (!screenshot?.base64) {
    try {
      const shot = await captureScreenshot({ serial: input.serial });
      if (shot.base64) {
        screenshot = { base64: shot.base64, mime: shot.mime ?? "image/png" };
      }
    } catch {
      screenshot = undefined;
    }
  }

  if (screenshot?.base64) {
    const vision = await grounder.groundVision({
      target: query,
      screenshotBase64: screenshot.base64,
      mime: screenshot.mime,
      candidates,
    });
    if (vision) {
      return {
        interaction: vision.interaction,
        method: "vision",
        confidence: vision.confidence,
        candidates,
      };
    }
  }

  throw new GroundingError(
    `No unique match for ${JSON.stringify(query)} (a11y, heuristic, and vision all missed)`,
    candidates,
  );
}

/** Ground a text target then commit the interaction. */
export async function groundAndInteract(input: GroundTargetInput): Promise<{
  grounding: GroundingResult;
  interact: Awaited<ReturnType<typeof interact>>;
}> {
  const grounding = await groundTarget(input);
  const result = await interact(grounding.interaction, { serial: input.serial });
  return { grounding, interact: result };
}

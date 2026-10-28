import type { SnapshotNode } from "./device.js";
import type { NamedControlResolution } from "./device-target-resolution.js";
import { now } from "./events.js";
import type { TextEntryTarget } from "./text-entry-focus.js";
import type { RuntimeTargetOverlay } from "./workspace-devices.js";
import { captureSnapshot } from "./workspace-capture.js";
import { interact, type InteractInput, type InteractResult } from "./workspace-interact.js";

export type PromptSend = { identifier?: string; label?: string } | "enter" | "none";

export type PromptInput = {
  text: string;
  /** Defaults to the focused editable field, else the lowest visible one. */
  composer?: TextEntryTarget;
  /** Defaults to the nearest visible Send/Submit control, else the Enter key. */
  send?: PromptSend;
  /** Wait for the reply to stop changing. Defaults to true. */
  wait?: boolean;
  timeoutMs?: number;
  stableForMs?: number;
};

export type PromptSent =
  | { method: "control"; label: string; point?: { x: number; y: number } }
  | { method: "enter" }
  | { method: "none" };

export type PromptReply = {
  status: "idle" | "timeout" | "not-waited";
  waitedMs: number;
  samples: number;
  /** Visible text that was not on screen before the prompt, in screen order. */
  newText: string[];
};

export type PromptResult = {
  composer?: NamedControlResolution;
  sent: PromptSent;
  reply: PromptReply;
};

export type PromptDeps = {
  interact: (input: InteractInput) => Promise<InteractResult>;
  nodes: () => Promise<readonly SnapshotNode[]>;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
};

export const PROMPT_DEFAULT_TIMEOUT_MS = 90_000;
export const PROMPT_MAX_TIMEOUT_MS = 300_000;
const PROMPT_DEFAULT_STABLE_MS = 2_000;
const PROMPT_POLL_MS = 300;
const MAX_REPLY_LINES = 40;
const MAX_REPLY_LINE_CHARS = 500;
const SEND_CONTROL = /\b(?:send|submit)\b/iu;
const BUSY_CONTROL = /^(?:stop|stop (?:generating|response|streaming)|cancel generation)$/iu;

export class PromptComposerNotFoundError extends Error {
  constructor() {
    super(
      'No editable composer is visible. Open the chat screen first, or pass "composer": {"identifier": "..."}.',
    );
    this.name = "PromptComposerNotFoundError";
  }
}

function center(rect: NonNullable<SnapshotNode["rect"]>): { x: number; y: number } {
  return { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2) };
}

function visible(
  node: SnapshotNode,
): node is SnapshotNode & { rect: NonNullable<SnapshotNode["rect"]> } {
  return (
    node.visibleToUser !== false &&
    node.rect !== undefined &&
    node.rect.width > 0 &&
    node.rect.height > 0
  );
}

/** The composer an agent would tap: focused first, else the lowest editable field. */
export function defaultComposer(nodes: readonly SnapshotNode[]): TextEntryTarget | undefined {
  const editable = nodes.filter((node) => node.editable === true && visible(node));
  const chosen =
    editable.find((node) => node.focused === true) ??
    [...editable].sort((a, b) => b.rect!.y + b.rect!.height - (a.rect!.y + a.rect!.height))[0];
  if (!chosen?.rect) return undefined;
  const sameIdentifier = chosen.identifier
    ? editable.filter((node) => node.identifier === chosen.identifier).length
    : 0;
  return sameIdentifier === 1 ? { identifier: chosen.identifier } : { point: center(chosen.rect) };
}

function nodeName(node: SnapshotNode): string {
  return (node.label || node.description || node.identifier || "").trim();
}

/** Nearest visible Send/Submit control to the composer, if the app exposes one. */
export function findSendControl(
  nodes: readonly SnapshotNode[],
  near?: { x: number; y: number },
): { label: string; point: { x: number; y: number } } | undefined {
  const candidates = nodes
    .filter(
      (node) =>
        visible(node) &&
        node.editable !== true &&
        node.enabled !== false &&
        node.hittable !== false &&
        SEND_CONTROL.test(nodeName(node)),
    )
    .map((node) => ({ label: nodeName(node), point: center(node.rect!) }));
  if (!near) return candidates[0];
  const distance = (point: { x: number; y: number }) =>
    Math.hypot(point.x - near.x, point.y - near.y);
  return candidates.sort((a, b) => distance(a.point) - distance(b.point))[0];
}

function visibleText(node: SnapshotNode): string | undefined {
  if (node.editable === true || !visible(node)) return undefined;
  const text = (node.value || node.label || node.content || "").trim();
  return text || undefined;
}

function isBusy(nodes: readonly SnapshotNode[]): boolean {
  return nodes.some((node) => visible(node) && BUSY_CONTROL.test(nodeName(node)));
}

/** Text that appeared after the prompt, excluding the echoed prompt itself. */
export function replyText(
  nodes: readonly SnapshotNode[],
  before: ReadonlySet<string>,
  prompt: string,
): string[] {
  const echo = prompt.trim();
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const node of nodes) {
    const text = visibleText(node);
    if (!text || before.has(text) || seen.has(text) || text === echo) continue;
    if (BUSY_CONTROL.test(text)) continue;
    seen.add(text);
    lines.push(
      text.length > MAX_REPLY_LINE_CHARS ? `${text.slice(0, MAX_REPLY_LINE_CHARS)}…` : text,
    );
    if (lines.length >= MAX_REPLY_LINES) break;
  }
  return lines;
}

function screenTexts(nodes: readonly SnapshotNode[]): Set<string> {
  return new Set(nodes.map(visibleText).filter((text): text is string => text !== undefined));
}

async function sendPrompt(
  send: PromptSend,
  deps: PromptDeps,
  composer: NamedControlResolution | undefined,
): Promise<PromptSent> {
  if (send === "none") return { method: "none" };
  if (send === "enter") {
    await deps.interact({ kind: "key", key: "enter" });
    return { method: "enter" };
  }
  if (send.identifier || send.label) {
    const result = await deps.interact(
      send.identifier
        ? { kind: "identifier", identifier: send.identifier }
        : { kind: "label", label: send.label! },
    );
    return {
      method: "control",
      label: send.label ?? send.identifier!,
      ...(result.resolution ? { point: result.resolution.point } : {}),
    };
  }
  const control = findSendControl(await deps.nodes(), composer?.point);
  if (!control) {
    await deps.interact({ kind: "key", key: "enter" });
    return { method: "enter" };
  }
  await deps.interact({ kind: "point", ...control.point });
  return { method: "control", ...control };
}

async function waitForReply(
  input: PromptInput,
  deps: PromptDeps,
  before: ReadonlySet<string>,
): Promise<PromptReply> {
  const clock = deps.now ?? now;
  const pause = deps.sleep ?? ((ms: number) => new Promise<void>((done) => setTimeout(done, ms)));
  const timeoutMs = Math.min(input.timeoutMs ?? PROMPT_DEFAULT_TIMEOUT_MS, PROMPT_MAX_TIMEOUT_MS);
  const stableForMs = input.stableForMs ?? PROMPT_DEFAULT_STABLE_MS;
  const began = clock();
  let samples = 0;
  let signature = "";
  let stableSince = began;
  let newText: string[] = [];
  while (clock() - began < timeoutMs) {
    await pause(PROMPT_POLL_MS);
    const nodes = await deps.nodes();
    samples += 1;
    newText = replyText(nodes, before, input.text);
    const next = newText.join("\n");
    const at = clock();
    if (next !== signature) {
      signature = next;
      stableSince = at;
      continue;
    }
    if (newText.length > 0 && !isBusy(nodes) && at - stableSince >= stableForMs) {
      return { status: "idle", waitedMs: at - began, samples, newText };
    }
  }
  return { status: "timeout", waitedMs: clock() - began, samples, newText };
}

/** Focus the composer, type, send, and optionally wait until the reply settles. */
export async function promptTarget(input: PromptInput, deps: PromptDeps): Promise<PromptResult> {
  const beforeNodes = await deps.nodes();
  const target = input.composer ?? defaultComposer(beforeNodes);
  if (!target) throw new PromptComposerNotFoundError();
  const typed = await deps.interact({ kind: "replace", text: input.text, target });
  const sent = await sendPrompt(input.send ?? {}, deps, typed.resolution);
  const reply =
    input.wait === false || sent.method === "none"
      ? { status: "not-waited" as const, waitedMs: 0, samples: 0, newText: [] }
      : await waitForReply(input, deps, screenTexts(beforeNodes));
  return { ...(typed.resolution ? { composer: typed.resolution } : {}), sent, reply };
}

/** promptTarget against a live device, through the same interact path as manual control. */
export async function promptDevice(
  input: PromptInput,
  opts: { serial: string; overlay?: RuntimeTargetOverlay },
): Promise<PromptResult> {
  return promptTarget(input, {
    interact: (interaction) =>
      interact(interaction, {
        serial: opts.serial,
        ...(opts.overlay ? { overlay: opts.overlay } : {}),
      }),
    nodes: async () =>
      (
        await captureSnapshot({
          serial: opts.serial,
          includeVisual: false,
          ...(opts.overlay ? { overlay: opts.overlay } : {}),
        })
      ).nodes,
  });
}

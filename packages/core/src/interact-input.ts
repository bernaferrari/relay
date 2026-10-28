/**
 * One boundary that turns a caller's interaction JSON into a complete
 * InteractInput. Agents reach for neighbouring field names (`text` on a
 * text-match, `label` on a find); those aliases are accepted here so the
 * resolver never sees an undefined selector.
 */
import type { InteractInput, InteractKey, TextEntryTarget } from "./workspace-interact.js";

export const INTERACT_KEYS: readonly InteractKey[] = [
  "enter",
  "backspace",
  "back",
  "home",
  "recents",
  "hide-keyboard",
];

export class InvalidInteractInputError extends Error {
  override name = "InvalidInteractInputError";
}

type RawInteraction = Record<string, unknown>;

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function finitePoint(value: unknown): { x: number; y: number } | undefined {
  if (!value || typeof value !== "object") return undefined;
  const { x, y } = value as { x?: unknown; y?: unknown };
  return typeof x === "number" && Number.isFinite(x) && typeof y === "number" && Number.isFinite(y)
    ? { x, y }
    : undefined;
}

function optionalPoint(raw: RawInteraction): { point: { x: number; y: number } } | object {
  const point = finitePoint(raw.point);
  return point ? { point } : {};
}

function missing(kind: string, field: string, example: string): InvalidInteractInputError {
  return new InvalidInteractInputError(`kind "${kind}" needs "${field}". Example: ${example}`);
}

function textEntryTarget(value: unknown): TextEntryTarget | undefined {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as RawInteraction;
  const target: TextEntryTarget = {
    ...(nonEmptyString(raw.identifier) ? { identifier: raw.identifier as string } : {}),
    ...(nonEmptyString(raw.ref) ? { ref: raw.ref as string } : {}),
    ...(nonEmptyString(raw.label) ? { label: raw.label as string } : {}),
    ...(nonEmptyString(raw.text) ? { text: raw.text as string } : {}),
    ...optionalPoint(raw),
  };
  return Object.keys(target).length > 0 ? target : undefined;
}

/** Validate and complete one interaction. Throws InvalidInteractInputError. */
export function normalizeInteractInput(input: InteractInput | RawInteraction): InteractInput {
  if (!input || typeof input !== "object") {
    throw new InvalidInteractInputError("Interaction input must be an object with a kind.");
  }
  const raw = input as RawInteraction;
  const kind = raw.kind;
  switch (kind) {
    case "identifier": {
      const identifier = nonEmptyString(raw.identifier);
      if (!identifier) {
        throw missing(kind, "identifier", '{"kind":"identifier","identifier":"send_button"}');
      }
      return { kind, identifier, ...optionalPoint(raw) };
    }
    case "label": {
      const label = nonEmptyString(raw.label) ?? nonEmptyString(raw.text);
      if (!label) throw missing(kind, "label", '{"kind":"label","label":"Continue"}');
      const heading = nonEmptyString(raw.heading);
      return { kind, label, ...(heading ? { heading } : {}), ...optionalPoint(raw) };
    }
    case "text-match": {
      const match =
        nonEmptyString(raw.match) ?? nonEmptyString(raw.text) ?? nonEmptyString(raw.label);
      if (!match) throw missing(kind, "match", '{"kind":"text-match","match":"Thought for"}');
      return { kind, match, ...optionalPoint(raw) };
    }
    case "find": {
      const query =
        nonEmptyString(raw.query) ?? nonEmptyString(raw.text) ?? nonEmptyString(raw.label);
      if (!query) throw missing(kind, "query", '{"kind":"find","query":"Settings"}');
      return { kind, query, ...optionalPoint(raw) };
    }
    case "point": {
      const point =
        typeof raw.x === "number" && typeof raw.y === "number"
          ? finitePoint({ x: raw.x, y: raw.y })
          : finitePoint(raw.point);
      if (!point) throw missing(kind, "x and y", '{"kind":"point","x":540,"y":1200}');
      return { kind, x: point.x, y: point.y };
    }
    case "ref": {
      const ref = nonEmptyString(raw.ref);
      if (!ref) throw missing(kind, "ref", '{"kind":"ref","ref":"@e12"}');
      return { kind, ref };
    }
    case "swipe": {
      const from = finitePoint(raw.from);
      const to = finitePoint(raw.to);
      if (!from || !to) {
        throw missing(
          kind,
          "from and to",
          '{"kind":"swipe","from":{"x":540,"y":1800},"to":{"x":540,"y":650}}',
        );
      }
      const durationMs = raw.durationMs;
      if (
        durationMs !== undefined &&
        (typeof durationMs !== "number" ||
          !Number.isFinite(durationMs) ||
          durationMs < 50 ||
          durationMs > 5_000)
      ) {
        throw new InvalidInteractInputError("Swipe durationMs must be between 50 and 5000.");
      }
      return { kind, from, to, ...(typeof durationMs === "number" ? { durationMs } : {}) };
    }
    case "key": {
      const key = INTERACT_KEYS.find((candidate) => candidate === raw.key);
      if (!key) {
        throw new InvalidInteractInputError(
          `kind "key" needs "key" as one of ${INTERACT_KEYS.join(", ")}. "back" navigates; use "hide-keyboard" to close only the keyboard.`,
        );
      }
      return { kind, key };
    }
    case "type": {
      if (typeof raw.text !== "string" || raw.text.length === 0) {
        throw missing(
          kind,
          "text",
          '{"kind":"type","text":"hello","target":{"identifier":"chat_text_input"}}',
        );
      }
      const target = textEntryTarget(raw.target);
      return { kind, text: raw.text, ...(target ? { target } : {}) };
    }
    case "replace": {
      const target = textEntryTarget(raw.target);
      if (!target) {
        throw missing(
          kind,
          "target",
          '{"kind":"replace","target":{"identifier":"chat_text_input"},"text":"hello"}',
        );
      }
      if (typeof raw.text !== "string") {
        throw missing(kind, "text", '{"kind":"replace","target":{"label":"Search"},"text":""}');
      }
      return { kind, target, text: raw.text };
    }
    default:
      throw new InvalidInteractInputError(
        `Unknown interaction kind ${JSON.stringify(kind)}. Use identifier, label, text-match, find, point, ref, swipe, key, type, or replace.`,
      );
  }
}

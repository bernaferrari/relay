import type { RecipeStep } from "../context/server";

export type PlannedInstruction = { source: string; step: RecipeStep };

const quoted = /[“"]([^”"]+)[”"]/;

function targetFrom(text: string): { label: string } {
  const match = text.match(quoted)?.[1]?.trim();
  const fallback = text
    .replace(
      /^(tap|click|press|select|choose|open|wait for|verify|check|assert|see|expect)\s+(that\s+)?/i,
      "",
    )
    .replace(/\s+(is|to be)\s+(visible|shown|displayed|gone|hidden).*$/i, "")
    .replace(/\s+(appears?|shows? up|is displayed|disappears?|vanishe?s)\s*$/i, "")
    .replace(/[,.!]$/, "")
    .trim();
  return { label: match || fallback || "Element" };
}

function textValue(text: string): string {
  return text.match(quoted)?.[1]?.trim() ?? text.replace(/^(type|enter|input|copy)\s+/i, "").trim();
}

function instructionToStep(instruction: string): RecipeStep {
  const text = instruction.trim();
  // “Open/launch the app” means launching the app under test, not tapping a
  // visible element called “the app”.
  if (/^(open|launch|start)\s+(the\s+)?app\s*$/i.test(text)) return { kind: "app", action: "open" };
  // “Open Settings” is how people speak; only “open app …” is a distinct
  // device command. Everything else is a visible target interaction.
  if (/^(tap|click|press|select|choose|open(?!\s+app\b))\b/i.test(text))
    return { kind: "tap", target: targetFrom(text) };
  if (/^(type|enter|input)\b/i.test(text)) return { kind: "type", text: textValue(text) };
  if (/^(verify|check|assert|see|expect)\b/i.test(text)) {
    return {
      kind: "expect",
      target: targetFrom(text),
      condition: /\b(gone|hidden|not visible|disappears?|vanishe?s)\b/i.test(text)
        ? "gone"
        : "visible",
    };
  }
  if (/^wait\b/i.test(text)) {
    const seconds = Number(text.match(/(\d+(?:\.\d+)?)\s*(?:s|sec|second)/i)?.[1]);
    if (Number.isFinite(seconds) && seconds > 0) return { kind: "sleep", ms: seconds * 1000 };
    return { kind: "wait-for", target: targetFrom(text) };
  }
  if (/^(take |capture )?(a )?screenshot\b/i.test(text))
    return {
      kind: "screenshot",
      caption: text.replace(/^(take |capture )?(a )?screenshot\s*/i, ""),
    };
  if (/\block (the )?(device|screen)\b/i.test(text)) return { kind: "device", action: "lock" };
  if (/\bunlock (the )?(device|screen)\b/i.test(text)) return { kind: "device", action: "unlock" };
  if (/^(go )?back\b/i.test(text)) return { kind: "key", key: "back" };
  if (/^(go )?home\b/i.test(text)) return { kind: "key", key: "home" };
  if (/\bapp switch(er)?\b/i.test(text)) return { kind: "app", action: "switcher" };
  if (/^open app\b/i.test(text))
    return { kind: "app", action: "open", app: text.replace(/^open app\s*/i, "").trim() };
  if (/^scroll\b/i.test(text))
    return { kind: "scroll", direction: /\bup\b/i.test(text) ? "up" : "down" };
  if (/^copy\b/i.test(text)) return { kind: "clipboard", action: "write", text: textValue(text) };
  if (/^paste\b/i.test(text)) return { kind: "clipboard", action: "read" };
  if (/^(confirm|review|judge|compare|manually check|inspect)\b/i.test(text)) {
    return {
      kind: "review",
      capability: "Human verification",
      reason: text,
      note: "Generated as a deferred check from a natural-language instruction",
    };
  }
  return { kind: "pause", message: text, note: "Generated from a natural-language instruction" };
}

const CLAUSE_VERBS =
  "tap|click|press|select|choose|open|launch|type|enter|input|verify|check|assert|see|expect|wait|scroll|copy|paste";

export function planTestPrompt(prompt: string): PlannedInstruction[] {
  // Split on newlines, connectors, and commas/“and” only when the next clause
  // starts with a known verb — otherwise “check that an error message appears”
  // is swallowed into the previous step’s text.
  const splitter = new RegExp(
    `\\s*(?:\\n+|;|→|\\bthen\\b|(?:,\\s*)?\\band\\b(?=\\s*(?:${CLAUSE_VERBS})\\b)|,(?=\\s*(?:${CLAUSE_VERBS})\\b))\\s*`,
    "i",
  );
  return prompt
    .split(new RegExp(splitter, "gi"))
    .map((part) => part.trim())
    .filter(Boolean)
    .map((source) => ({ source, step: instructionToStep(source) }));
}

import type { RecipeStep } from "../context/server";

export type PlannedInstruction = { source: string; step: RecipeStep };

const quoted = /[“"]([^”"]+)[”"]/;

function targetFrom(text: string): { label: string } {
  const match = text.match(quoted)?.[1]?.trim();
  const fallback = text
    .replace(
      /^(tap|click|press|select|choose|open|wait for|verify|check|assert|see|expect)\s+/i,
      "",
    )
    .replace(/\s+(is|to be)\s+(visible|shown|gone|hidden).*$/i, "")
    .replace(/[,.!]$/, "")
    .trim();
  return { label: match || fallback || "Element" };
}

function textValue(text: string): string {
  return text.match(quoted)?.[1]?.trim() ?? text.replace(/^(type|enter|input|copy)\s+/i, "").trim();
}

function instructionToStep(instruction: string): RecipeStep {
  const text = instruction.trim();
  // “Open Settings” is how people speak; only “open app …” is a distinct
  // device command. Everything else is a visible target interaction.
  if (/^(tap|click|press|select|choose|open(?!\s+app\b))\b/i.test(text))
    return { kind: "tap", target: targetFrom(text) };
  if (/^(type|enter|input)\b/i.test(text)) return { kind: "type", text: textValue(text) };
  if (/^(verify|check|assert|see|expect)\b/i.test(text)) {
    return {
      kind: "expect",
      target: targetFrom(text),
      condition: /\b(gone|hidden|not visible|disappears?)\b/i.test(text) ? "gone" : "visible",
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
  return { kind: "pause", message: text, note: "Generated from a natural-language instruction" };
}

export function planTestPrompt(prompt: string): PlannedInstruction[] {
  return prompt
    .split(
      /\s*(?:\n+|\bthen\b|;|→|,(?=\s*(?:tap|click|press|select|choose|open|type|enter|input|verify|check|assert|see|expect|wait|scroll|copy|paste)\b))\s*/i,
    )
    .map((part) => part.trim())
    .filter(Boolean)
    .map((source) => ({ source, step: instructionToStep(source) }));
}

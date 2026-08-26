/**
 * Reading switcher option rows out of an accessibility tree.
 *
 * One picker screen, one list of mutually exclusive rows. This half is pure:
 * it takes nodes and returns options, so a scan, a replay and a test all read
 * the same rows without touching a device.
 */
import type { SnapshotNode } from "./device.js";
import type { SwitcherOption } from "./switcher-profiles.js";

const CHROME_NOISE =
  /^(settings|search|cancel|done|edit|back|close|general|about|ok|save|add |preferred |reorder|app language|language|appearance|account|environment|theme|suggested languages|other languages|allow grok to access|grok settings|acknowledgements|photos|microphone|camera|siri & search|notifications|live activities|background app refresh|full access|airplane mode|wi-?fi|bluetooth|vpn|sounds|focus|screen time|control center|display & brightness|apple id.*|jonathan .*|multitasking.*|accessibility|wallpaper|apple pencil|touch id.*|battery|privacy.*|app store|wallet.*|passwords|contacts|calendar|notes|reminders|freeform|voice memos|messages|safari|stocks|weather|translate|maps|measure|shortcuts|health|game center|tv provider|developer|1blocker|bible|bitwarden|chrome|documents|drive|gmail|google photos|legacy|testflight|\bx\b)$/i;

/** Left-pane / system settings rows that appear in the same AX tree on iPad split view. */
const SPLIT_VIEW_SETTINGS_NOISE =
  /^(jonathan|apple id|airplane|wi-?fi|bluetooth|vpn|notifications|sounds|focus|screen time|general|control center|display|home screen|notes|voice memos|messages|stocks|translate|books|game center|tv provider|developer|bible|bitwarden|documents|drive|google photos|testflight|photos,|microphone|camera|siri|live activities|background app refresh|preferred language|allow grok|grok settings|acknowledgements|language & region|language, english)$/i;

export function inferOptionId(label: string, subtitle?: string): string {
  const source = `${subtitle ?? ""} ${label}`.trim();
  // Language heuristics (optional enrichment — unknown labels still get a slug).
  // Prefer explicit checks for common locales so regex unicode edge-cases cannot
  // skip the English seed used throughout Corpus/locale-matrix.
  if (/\benglish\b/i.test(source) || /^en(?:[-_]|$)/i.test(label.trim())) return "en";
  const languageTable: Array<[RegExp, string]> = [
    [/portugu[eê]s\s*\(?\s*brasil\s*\)?|portuguese\s*\(?\s*brazil\s*\)?|\bpt-?br\b/i, "pt-BR"],
    [/portugu[eê]s|\bportuguese\b|\bpt-?pt\b/i, "pt"],
    [/\bitalian\b|\bitaliano\b|\bit\b/i, "it"],
    [/spanish\s*\(\s*latin|espa[nñ]ol\s*\(\s*latino|\bes-?419\b|\bes-?mx\b/i, "es-419"],
    [/\bspanish\b|\bespa[nñ]ol\b|\bes\b/i, "es"],
    [/fran[cç]ais\s*\(\s*canada\s*\)?|french\s*\(\s*canada\s*\)?|\bfr-?ca\b/i, "fr-CA"],
    [/\bfrench\b|fran[cç]ais|\bfr\b/i, "fr"],
    [/\bgerman\b|\bdeutsch\b|\bde\b/i, "de"],
    [/traditional.*chinese|繁體|\bzh-?hant\b|\bzh-?tw\b/i, "zh-Hant"],
    [/simplified.*chinese|简体|\bzh-?hans\b|\bzh-?cn\b/i, "zh-Hans"],
    [/\bchinese\b|中文/i, "zh"],
    [/\bjapanese\b|日本語|\bja\b/i, "ja"],
    [/\bkorean\b|한국어|\bko\b/i, "ko"],
    [/\bdutch\b|\bnederlands\b|\bnl\b/i, "nl"],
    // Plain "العربية" is Arabic; only the parenthesised row is Saudi. Matching
    // the bare native name here swallowed both rows into one ar-SA entry.
    [/arabic\s*\(\s*saudi|العربية\s*\(|\bar-?sa\b/i, "ar-SA"],
    [/\barabic\b|العربية|\bar\b/i, "ar"],
    [/\bhindi\b|हिन्दी|हिंदी|\bhi\b/i, "hi"],
    [/\brussian\b|русский|\bru\b/i, "ru"],
    [/\bturkish\b|türkçe|\btr\b/i, "tr"],
    [/\bpolish\b|\bpolski\b|\bpl\b/i, "pl"],
    [/\bdanish\b|\bdansk\b|\bda\b/i, "da"],
    [/\bfinnish\b|\bsuomi\b|\bfi\b/i, "fi"],
    [/\bswedish\b|\bsvenska\b|\bsv\b/i, "sv"],
    [/norwegian|norsk|\bnb-?no\b|\bnb\b/i, "nb"],
    [/\bgreek\b|ελληνικά|\bel\b/i, "el"],
    [/\bhebrew\b|עברית|\bhe\b/i, "he"],
    [/\bhungarian\b|\bmagyar\b|\bhu\b/i, "hu"],
    [/bahasa indonesia|\bindonesian\b|\bid\b/i, "id"],
    [/bahasa melayu|\bmalay\b|\bms\b/i, "ms"],
    [/\bcroatian\b|\bhrvatski\b|\bhr\b/i, "hr"],
    [/\bczech\b|\bčeština\b|\bcestina\b|\bcs\b/i, "cs"],
    [/\bbulgarian\b|български|\bbg\b/i, "bg"],
    [/\bromanian\b|rom[aâ]nă|\bro\b/i, "ro"],
    [/\bukrainian\b|українська|\buk\b/i, "uk"],
    [/\bvietnamese\b|tiếng việt|\bvi\b/i, "vi"],
    [/\bthai\b|ภาษาไทย|\bth\b/i, "th"],
    [/\btamil\b|தமிழ்|\bta\b/i, "ta"],
    [/\btelugu\b|తెలుగు|\bte\b/i, "te"],
    [/\bbangla\b|\bbengali\b|বাংলা|\bbn\b/i, "bn"],
    [/\bmarathi\b|मराठी|\bmr\b/i, "mr"],
    [/\burdu\b|اردو|\bur\b/i, "ur"],
    [/\bpersian\b|\bfarsi\b|فارسی|\bfa\b/i, "fa"],
    [/\bfilipino\b|\btagalog\b|\bfil\b|\btl\b/i, "fil"],
  ];
  for (const [pattern, id] of languageTable) {
    if (pattern.test(source)) return id;
  }
  // Common non-language option patterns
  if (/\bprod(uction)?\b/i.test(source)) return "production";
  if (/\bstag(e|ing)?\b/i.test(source)) return "staging";
  if (/\bdev(elopment)?\b/i.test(source)) return "development";
  if (/\bdark\b/i.test(source)) return "dark";
  if (/\blight\b/i.test(source)) return "light";
  if (/\bsystem\b/i.test(source)) return "system";

  return (
    label
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLocaleLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 32) || "option"
  );
}

export function extractSwitcherOptionsFromNodes(nodes: SnapshotNode[]): SwitcherOption[] {
  type Candidate = {
    label: string;
    identifier?: string;
    y: number;
    x: number;
    subtitle?: string;
    isCell: boolean;
  };
  const candidates: Candidate[] = [];
  const byParent = new Map<number, SnapshotNode[]>();
  for (const node of nodes) {
    if (node.parentIndex === undefined) continue;
    const list = byParent.get(node.parentIndex) ?? [];
    list.push(node);
    byParent.set(node.parentIndex, list);
  }

  // iPad split-view: option lists live in the right half. Prefer cells whose
  // center is on the right side when a wide landscape tree is present.
  const xs = nodes.map((node) => node.rect?.x ?? 0);
  const widths = nodes.map((node) => (node.rect?.x ?? 0) + (node.rect?.width ?? 0));
  const minX = xs.length ? Math.min(...xs) : 0;
  const maxX = widths.length ? Math.max(...widths) : 0;
  const midX = minX + (maxX - minX) * 0.45;
  const wideSplit = maxX - minX > 700;

  for (const node of nodes) {
    if (node.visibleToUser === false || node.enabled === false) continue;
    const type = (node.type ?? node.role ?? "").toLocaleLowerCase();
    const rawLabel = (node.label ?? "").trim();
    if (
      !rawLabel ||
      CHROME_NOISE.test(rawLabel) ||
      /^reorder\s+/i.test(rawLabel) ||
      rawLabel.length > 80
    ) {
      continue;
    }
    // Cell a11y often "Português (Brasil), Portuguese (Brazil)" — take primary.
    const parts = rawLabel
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean);
    const label = parts[0] ?? rawLabel;
    if (!label || CHROME_NOISE.test(label) || SPLIT_VIEW_SETTINGS_NOISE.test(label)) continue;

    const isCell = type === "cell";
    const isRow = isCell || type === "button" || type === "statictext" || Boolean(node.hittable);
    if (!isRow) continue;
    if (!isCell && type === "statictext" && node.parentIndex !== undefined) {
      const parent = nodes[node.parentIndex];
      const parentType = (parent?.type ?? parent?.role ?? "").toLocaleLowerCase();
      if (parentType === "cell" || parentType === "button") continue;
    }
    if (!isCell && SPLIT_VIEW_SETTINGS_NOISE.test(rawLabel)) continue;

    const centerX = (node.rect?.x ?? 0) + (node.rect?.width ?? 0) / 2;
    if (
      wideSplit &&
      isCell &&
      centerX < midX &&
      !/english|portug|italiano|français|deutsch|español|中文|日本語|한국어|العربية/i.test(label)
    ) {
      // Left settings pane cells on iPad — skip unless they look like languages.
      continue;
    }

    // The English gloss belongs to this row only. It lives on the row's own
    // value ("Italiano" / "Italian") or on one of its children. Reading the
    // row's *siblings* pulls a neighbouring language's gloss into this row and
    // silently tags it as that language.
    const children = typeof node.index === "number" ? (byParent.get(node.index) ?? []) : [];
    const ownValue = (node.value ?? "").trim();
    let subtitle: string | undefined = parts.length > 1 ? parts.slice(1).join(", ") : undefined;
    if (!subtitle && ownValue && ownValue !== label && !CHROME_NOISE.test(ownValue)) {
      subtitle = ownValue;
    }
    if (!subtitle) {
      const texts = children
        .map((kid) => (kid.label ?? "").trim())
        .filter(
          (text) =>
            text &&
            text !== label &&
            text !== rawLabel &&
            !CHROME_NOISE.test(text) &&
            text.length < 60 &&
            !/^reorder/i.test(text),
        );
      subtitle =
        texts.find((text) => /^[A-Za-z][A-Za-z\s'(),-]+$/.test(text) && text !== label) ?? texts[0];
    }
    // iOS list rows carry the accessibility identifier on the title label, not
    // on the cell, so an exact tap target exists only via that child.
    const identifier =
      node.identifier?.trim() ||
      children.find((kid) => (kid.label ?? "").trim() === label)?.identifier?.trim();
    candidates.push({
      label,
      y: node.rect?.y ?? 0,
      x: centerX,
      isCell,
      ...(identifier ? { identifier } : {}),
      ...(subtitle ? { subtitle } : {}),
    });
  }

  // Prefer cells over loose static texts when both exist.
  const hasCells = candidates.some((candidate) => candidate.isCell);
  const filtered = hasCells ? candidates.filter((candidate) => candidate.isCell) : candidates;
  filtered.sort((left, right) => left.y - right.y || left.x - right.x);

  const seenLabel = new Set<string>();
  const options: SwitcherOption[] = [];
  for (const candidate of filtered) {
    const key = candidate.label.toLocaleLowerCase();
    if (seenLabel.has(key)) continue;
    seenLabel.add(key);
    const id = inferOptionId(candidate.label, candidate.subtitle);
    const aliases = new Set<string>();
    if (candidate.subtitle) aliases.add(candidate.subtitle);
    aliases.add(`Reorder ${candidate.label}`);
    options.push({
      id,
      label: candidate.label,
      ...(aliases.size ? { aliases: [...aliases] } : {}),
      ...(candidate.identifier ? { identifier: candidate.identifier } : {}),
    });
  }

  const byId = new Map<string, SwitcherOption>();
  for (const option of options) {
    const existing = byId.get(option.id);
    if (!existing) {
      byId.set(option.id, option);
      continue;
    }
    const aliases = new Set([...(existing.aliases ?? []), option.label, ...(option.aliases ?? [])]);
    aliases.delete(existing.label);
    byId.set(option.id, {
      ...existing,
      aliases: [...aliases],
      ...((existing.identifier ?? option.identifier)
        ? { identifier: existing.identifier ?? option.identifier }
        : {}),
    });
  }
  return [...byId.values()];
}

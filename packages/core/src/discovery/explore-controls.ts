import type { SnapshotNode } from "../device/device.js";
import { hasProfileChromePrefix } from "./discovery-app-profiles.js";

/** Destructive / external rows agents and crawls should skip by default. */
export function isUnsafeExploreControlText(value: string): boolean {
  return /(delete|remove|purchase|pay|subscribe|logout|sign out|password|permission|\bupdate\b|rate the app|terms of use|privacy policy|help & support|help and support|open in safari|open in browser|open in internet|\bsafari\b)/i.test(
    value,
  );
}

/**
 * Discovery maps should learn navigation before they exercise app state. A
 * stateful control can be perfectly safe for an intentional recording, but a
 * background explorer cannot know the user wants to change a setting. Keep
 * those controls out of its automatic queue while leaving them available to
 * the explicit recorder.
 */
export function isExploreStateChangingNode(node: SnapshotNode): boolean {
  return /switch|toggle|checkbox|radio(?:button)?|slider|seekbar|stepper|edit(?:able)?text|text(?:field|box)|input/i.test(
    `${node.role ?? ""} ${node.type ?? ""}`,
  );
}

export type ExploreChromeOptions = {
  /** When true, also treat app-language switcher rows as chrome (out-of-band only). */
  excludeLanguageSwitcher?: boolean;
};

/** Sheet chrome, search fields, and other non-content affordances. */
export function isExploreChromeLabel(value: string, options?: ExploreChromeOptions): boolean {
  const label = value.trim().toLocaleLowerCase();
  if (!label) return true;
  if (
    /^(close|done|cancel|back|dismiss|dismiss popup|home|recents|recent apps|overview|navigate up|voice search|what are you looking for\??|more options|ask anything|launch gallery selector|open microsoft swiftkey toolbar|start dictation|voice typing|symbols and numbers|double tap for caps lock|search|search settings)$/i.test(
      label,
    )
  ) {
    return true;
  }
  if (/^capital [a-z]$/i.test(label)) return true;
  // Toolbar / brand affordances that leak into a11y trees. Which words an app
  // stamps on its own chrome is profile data, not a platform fact.
  if (hasProfileChromePrefix(label)) return true;
  if (/^toolbar\./i.test(label)) return true;
  // Scrollbars and page indicators are not navigation.
  if (/scroll bar|scrollbar|vertical scroll|horizontal scroll|page indicator/i.test(label)) {
    return true;
  }
  // Pure switch values often appear as sibling "0"/"1" controls.
  if (/^[01]$/.test(label)) return true;
  if (/^localizedstringkey\(key: "(close|done|cancel|back)"/i.test(label)) return true;
  if (
    options?.excludeLanguageSwitcher !== false &&
    /app language|idioma do app|langue de l.application|app-sprache|idioma de la app/i.test(label)
  ) {
    return true;
  }
  // Section headers often appear as all-caps cells (APP, CHAT, VOICE).
  if (/^[A-Z0-9][A-Z0-9 &/.-]{0,22}$/.test(value.trim()) && value === value.toUpperCase()) {
    return true;
  }
  return false;
}

const EXPLORE_SYSTEM_OWNER =
  /(?:^|\s)(?:com\.android\.systemui|com\.touchtype\.swiftkey|com\.google\.android\.inputmethod\.latin|com\.samsung\.android\.honeyboard)(?::|\/|\.|\s|$)/i;
const EXPLORE_CHROME_IDENTIFIER =
  /(?:search_voice|search_bar|collapsing_appbar|floating_toolbar|sesl_floating_toolbar)/i;

/** System chrome, IME, and non-content affordances a crawler must not tap. */
export function isExploreChromeNode(node: SnapshotNode, options?: ExploreChromeOptions): boolean {
  const owner = `${node.bundleId ?? ""} ${node.identifier ?? ""}`;
  if (EXPLORE_SYSTEM_OWNER.test(owner)) return true;
  if (EXPLORE_CHROME_IDENTIFIER.test(node.identifier ?? "")) return true;
  const spoken = (node.label ?? node.value ?? "").trim();
  if (!spoken) return false;
  return isExploreChromeLabel(spoken, options);
}

export type ExploreControl = {
  label: string;
  stableKey?: string;
  role?: string;
  target: {
    identifier?: string;
    ref?: string;
    label?: string;
    text?: string;
  };
};

/**
 * Interactive candidates from one snapshot. Prefer identifiers / refs.
 * Callers that need domain-stable keys (i18n packs) should map further.
 */
export function exploreControls(
  nodes: SnapshotNode[],
  options?: {
    allowSensitive?: boolean;
    chrome?: ExploreChromeOptions;
    limit?: number;
  },
): ExploreControl[] {
  const seen = new Set<string>();
  const limit = Math.max(1, Math.min(120, options?.limit ?? 60));
  return nodes
    .filter(
      (node) =>
        node.visibleToUser !== false &&
        node.enabled !== false &&
        (node.hittable || node.identifier || node.ref || node.type === "Cell"),
    )
    .flatMap((node) => {
      const label = (node.label ?? node.value ?? node.identifier ?? "").trim();
      if (!label) return [];
      if (isExploreChromeNode(node, options?.chrome)) return [];
      if (!options?.allowSensitive && isUnsafeExploreControlText(label)) return [];
      const target = node.identifier
        ? { identifier: node.identifier }
        : node.ref
          ? { ref: node.ref }
          : node.label
            ? { label: node.label }
            : undefined;
      if (!target) return [];
      const key = JSON.stringify(target);
      if (seen.has(key)) return [];
      seen.add(key);
      return [
        {
          label,
          role: node.role ?? node.type,
          target,
        },
      ];
    })
    .slice(0, limit);
}

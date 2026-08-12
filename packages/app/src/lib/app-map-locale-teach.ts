/** Teach locale rows from the live list and reuse a recorded picker path. */

import type { ActionSpec, AppMap, RecipeStep } from "@relay/protocol";

export function taughtExampleFromSnapshotNode(node: {
  identifier?: string;
  label?: string;
  value?: string;
}): { locale: string; identifier?: string; label?: string } {
  const identifier = node.identifier?.trim();
  const label = (node.label ?? node.value ?? "").trim();
  const fromId = identifier?.match(/(?:^|[.:/_-])([a-z]{2}(?:-[A-Za-z]{2})?)$/i);
  const locale = (fromId?.[1] || identifier || label || "und").trim();
  return {
    locale,
    ...(identifier ? { identifier } : {}),
    ...(label ? { label } : {}),
  };
}

export function teachableLocaleRows(
  nodes: Array<{ identifier?: string; label?: string; value?: string; hittable?: boolean }>,
  limit = 12,
): Array<{ identifier?: string; label?: string; value?: string }> {
  const seen = new Set<string>();
  const rows: Array<{ identifier?: string; label?: string; value?: string }> = [];
  for (const node of nodes) {
    const label = (node.label ?? node.value ?? "").trim();
    const identifier = node.identifier?.trim();
    if (!label) continue;
    if (identifier && /^(?:com\.android\.systemui|android):/i.test(identifier)) continue;
    if (/^(?:back|home|recents)$/i.test(label)) continue;
    if (/^\d{1,2}:\d{2}(?:\s?[ap]m)?$/i.test(label)) continue;
    if (/notification:?$/i.test(label)) continue;
    const key = `${identifier ?? ""}|${label}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({
      ...(identifier ? { identifier } : {}),
      ...(label ? { label } : {}),
    });
    if (rows.length >= limit) break;
  }
  return rows;
}

const LANGUAGE_ROW_RE =
  /\b(?:arabic|bengali|chinese|dutch|english|french|german|greek|hebrew|hindi|indonesian|italian|japanese|korean|polish|portuguese|russian|spanish|swedish|thai|turkish|ukrainian|vietnamese)\b|(?:中文|日本語|한국어|العربية|हिन्दी|বাংলা|français|deutsch|italiano|português|русский|español|türkçe|ไทย|nederlands)/iu;

/** Avoid teaching a language variable from an arbitrary system picker or
 * document list. Identifiers from a genuine locale picker are also accepted
 * because some platforms localize every visible label. */
export function looksLikeLanguagePicker(
  rows: readonly { identifier?: string; label?: string; value?: string }[],
): boolean {
  return (
    rows.filter((row) => {
      const identifier = row.identifier ?? "";
      const label = row.label ?? row.value ?? "";
      return (
        /(?:^|[._:/-])(?:locale|language|lang)(?:$|[._:/-])/iu.test(identifier) ||
        LANGUAGE_ROW_RE.test(label)
      );
    }).length >= 2
  );
}

/**
 * The visible-list reader is deliberately literal: it can only teach from
 * the controls that are on the device right now. Keep its classification
 * separate from row extraction so the UI can say *why* an arbitrary picker
 * (most commonly Android's document picker) cannot become a Language
 * modifier.
 */
export type VisibleListRead = {
  rows: Array<{ identifier?: string; label?: string; value?: string }>;
  status: "ready" | "empty" | "not-language-list";
  context?: "file-picker";
};

function looksLikeFilePicker(
  nodes: readonly { identifier?: string; label?: string; value?: string }[],
): boolean {
  return nodes.some((node) => {
    const text = [node.identifier, node.label, node.value].filter(Boolean).join(" ");
    return /(?:documentsui|file\s*picker|\bfiles?\b|\.(?:jpg|jpeg|png|gif|webp|pdf|mp4)\b|\b(?:image|video|audio)\/)/iu.test(
      text,
    );
  });
}

/** Inspect the currently visible rows without pretending that Relay navigated
 * to them. Language modifiers require a real language picker; other modifier
 * kinds may learn any visible list. */
export function inspectVisibleList(
  nodes: Array<{ identifier?: string; label?: string; value?: string; hittable?: boolean }>,
  kind: string,
  limit = 24,
): VisibleListRead {
  const rows = teachableLocaleRows(nodes, limit);
  if (!rows.length) return { rows, status: "empty" };
  if (kind === "language" && !looksLikeLanguagePicker(rows)) {
    return {
      rows,
      status: "not-language-list",
      ...(looksLikeFilePicker(nodes) ? { context: "file-picker" as const } : {}),
    };
  }
  return { rows, status: "ready" };
}

export type LocaleNavStep = {
  kind: "tap" | "back" | "wait" | "scroll" | "relaunch" | "openApp";
  target?: { identifier?: string; label?: string; text?: string };
  ms?: number;
  direction?: "up" | "down";
  amount?: number;
  app?: string;
  relaunch?: boolean;
};

export type RecordedLocalePrelude = {
  entryPath: LocaleNavStep[];
  sourceConnectionId: string;
  sourceLabel: string;
};

const PICKER_SCREEN_RE = /language|locale|idioma|sprache|langue|言語|语言|語言/i;

export function isLocalePickerScreenTitle(title: string | undefined | null): boolean {
  return Boolean(title?.trim() && PICKER_SCREEN_RE.test(title));
}

function localeNavFromRecipeSteps(steps: readonly RecipeStep[]): LocaleNavStep[] {
  const out: LocaleNavStep[] = [];
  for (const step of steps) {
    if (step.kind === "tap") {
      const identifier = step.target.identifier?.trim();
      const label = step.target.label?.trim();
      const text = step.target.text?.trim();
      if (!identifier && !label && !text) continue;
      out.push({
        kind: "tap",
        target: {
          ...(identifier ? { identifier } : {}),
          ...(label ? { label } : {}),
          ...(text ? { text } : {}),
        },
      });
      continue;
    }
    if (step.kind === "sleep") {
      out.push({ kind: "wait", ms: Math.max(0, Math.min(120_000, Math.round(step.ms))) });
      continue;
    }
    if (step.kind === "key" && step.key === "back") {
      out.push({ kind: "back" });
      continue;
    }
    if (step.kind === "scroll") {
      out.push({
        kind: "scroll",
        direction: step.direction,
        ...(step.amount != null ? { amount: step.amount } : {}),
      });
      continue;
    }
    if (step.kind === "swipe") {
      out.push({ kind: "scroll", direction: step.from.y > step.to.y ? "down" : "up" });
      continue;
    }
    if (step.kind === "app" && step.action === "open" && step.app?.trim()) {
      out.push({
        kind: "openApp",
        app: step.app.trim(),
        ...(step.relaunch === true ? { relaunch: true } : {}),
      });
    }
  }
  return out;
}

function recipeStepsFromAction(action: ActionSpec): RecipeStep[] {
  if (action.kind === "recorded" || action.kind === "steps") return [...action.steps];
  if (action.kind === "tap") return [{ kind: "tap", target: action.target }];
  if (action.kind === "wait") return [{ kind: "sleep", ms: action.ms }];
  if (action.kind === "back") return [{ kind: "key", key: "back" }];
  if (action.kind === "home") return [{ kind: "key", key: "home" }];
  if (action.kind === "app" && action.action === "open" && action.app?.trim()) {
    return [
      {
        kind: "app",
        action: "open",
        app: action.app.trim(),
        ...(action.relaunch === true ? { relaunch: true } : {}),
      },
    ];
  }
  if (action.kind === "gesture" && action.gesture.kind === "scroll") {
    return [
      {
        kind: "scroll",
        direction: action.gesture.direction,
        ...(action.gesture.amount != null ? { amount: action.gesture.amount } : {}),
      },
    ];
  }
  if (action.kind === "gesture" && action.gesture.kind === "swipe") {
    return [
      {
        kind: "swipe",
        from: action.gesture.from,
        to: action.gesture.to,
        ...(action.gesture.durationMs != null ? { durationMs: action.gesture.durationMs } : {}),
      },
    ];
  }
  return [];
}

export function localeNavFromConnectionActions(actions: readonly ActionSpec[]): LocaleNavStep[] {
  return localeNavFromRecipeSteps(actions.flatMap((action) => recipeStepsFromAction(action)));
}

/** Recorded path that opens the language list. Grok nav is fallback only. */
export function recordedLocalePreludeFromMap(
  map: AppMap,
  input?: {
    bodyFlowId?: string;
    selectedConnectionId?: string;
    liveScreenId?: string;
    kind?: string;
  },
): RecordedLocalePrelude | undefined {
  const bodyIds = new Set(
    (input?.bodyFlowId?.trim() ? map.flows[input.bodyFlowId.trim()]?.connectionIds : undefined) ??
      [],
  );
  let best:
    | { connectionId: string; score: number; nav: LocaleNavStep[]; label: string }
    | undefined;

  for (const connection of Object.values(map.connections)) {
    const nav = localeNavFromConnectionActions(connection.actions);
    if (!nav.length) continue;
    const destTitle =
      connection.destination.kind === "screen"
        ? map.screens[connection.destination.screenId]?.title?.trim() ||
          connection.label?.trim() ||
          ""
        : connection.label?.trim() || "";
    const destScreenId =
      connection.destination.kind === "screen" ? connection.destination.screenId : "";
    const picker =
      (input?.kind === undefined || input.kind === "language") &&
      (isLocalePickerScreenTitle(destTitle) || isLocalePickerScreenTitle(connection.label));
    const live = Boolean(input?.liveScreenId?.trim() && destScreenId === input.liveScreenId.trim());
    const selected = Boolean(
      input?.selectedConnectionId?.trim() && connection.id === input.selectedConnectionId.trim(),
    );
    const inBody = bodyIds.has(connection.id);
    if (inBody && !picker && !live && !selected) continue;
    let score = 1;
    if (picker) score += 8;
    if (live) score += 6;
    if (selected) score += 4;
    if (inBody && !picker && !live) score -= 3;
    if (!best || score > best.score) {
      best = {
        connectionId: connection.id,
        score,
        nav,
        label: destTitle || connection.label || "recorded path",
      };
    }
  }
  if (!best || best.score < 1) return undefined;
  return {
    entryPath: best.nav,
    sourceConnectionId: best.connectionId,
    sourceLabel: best.label,
  };
}

export function assignableSwitcherConnections(map: AppMap): Array<{ id: string; label: string }> {
  return Object.values(map.connections)
    .filter((connection) => localeNavFromConnectionActions(connection.actions).length > 0)
    .map((connection) => {
      const dest =
        connection.destination.kind === "screen"
          ? map.screens[connection.destination.screenId]?.title
          : "end";
      const source = map.screens[connection.fromScreenId]?.title ?? "Start";
      return {
        id: connection.id,
        label: connection.label?.trim() || `${source} → ${dest || "next"}`,
      };
    });
}

export function localeLoopBodyFlowId(
  map: AppMap,
  preludeConnectionId?: string,
): string | undefined {
  const flows = Object.values(map.flows).filter((flow) => flow.connectionIds.length > 0);
  const distinct = preludeConnectionId
    ? flows.find((flow) => flow.connectionIds.some((id) => id !== preludeConnectionId))
    : undefined;
  return distinct?.id ?? flows[0]?.id ?? Object.values(map.flows)[0]?.id;
}

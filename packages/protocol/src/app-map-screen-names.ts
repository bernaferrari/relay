/**
 * Readable names for screens that were saved with a placeholder ("Next
 * screen") or with the name of the control that opened them ("Send prompt").
 *
 * Names come from what is on the screen and from the move that led there:
 * the nearest named area it belongs to ("Imagine") plus what the screen shows
 * ("reply", "draft", "result"). Siblings that would share a name get a short
 * detail of their own instead of repeating. Pure, so the projection can apply
 * it to existing maps without rewriting saved titles.
 */
import type { AppMap, NormalizedSemanticNode } from "./app-map.js";

export type ScreenNamingNode = Pick<NormalizedSemanticNode, "role" | "label" | "value" | "identifier">;

export type ScreenNamingInput = {
  screens: readonly {
    id: string;
    title: string;
    createdAt?: number;
    nodes: readonly ScreenNamingNode[];
  }[];
  /** Moves between screens. `label` is the step intent ("Tap “Send”"). */
  paths: readonly { from: string; to: string; label?: string; tapLabels?: readonly string[] }[];
  /** Where people enter the app. Area names never come from past an entry. */
  entryIds?: readonly string[];
};

const PLACEHOLDER = /^(?:start|next screen|known screen|untitled screen|screen|new screen)$/iu;
/** Verbs a control label starts with; a screen named this way is named after its button. */
const ACTION_VERB =
  /^(?:send|submit|post|tap|press|click|open|show|go(?:\s+to)?|view|type|enter|choose|select|start|create|add|save|confirm|continue|next)\b/iu;
const LEADING_NAV_VERB = /^(?:show|open|go\s+to|view)\s+/iu;
const EDITABLE = /edit\s*text|text\s*field|textfield|textarea|text\s*box|textbox|search\s*field|input/iu;

const REPLY = /^(?:copy (?:message|response|reply)|regenerate\b|like this (?:response|message)|dislike this|read aloud)/iu;
const WORKING = /^(?:stop(?: message| generating| response)?|cancel generation|generating\b|thinking\b|loading\b)/iu;
const VIEWER_ACTIONS = /^(?:download|share|save image|edit image|edit tools|add to favorites)$/iu;

/** True when a saved title says nothing about the screen. */
export function isPlaceholderScreenTitle(title: string): boolean {
  return PLACEHOLDER.test(title.trim());
}

/** True when a title reads like the control that opened the screen ("Send prompt"). */
export function isActionScreenTitle(title: string): boolean {
  return ACTION_VERB.test(title.trim());
}

function text(node: ScreenNamingNode): string {
  return (node.label ?? node.value ?? "").trim();
}

function capitalize(value: string): string {
  return value ? value[0]!.toLocaleUpperCase() + value.slice(1) : value;
}

/**
 * What the screen shows, from its own controls first and from the move that
 * led there second. Undefined when neither says anything useful.
 */
export function screenStateWord(
  nodes: readonly ScreenNamingNode[],
  intents: readonly string[] = [],
): string | undefined {
  const labels = nodes.map(text).filter(Boolean);
  if (labels.some((label) => REPLY.test(label))) return "reply";
  if (labels.some((label) => /^thinking\b/iu.test(label))) return "thinking";
  if (labels.some((label) => WORKING.test(label))) return "in progress";
  if (labels.filter((label) => VIEWER_ACTIONS.test(label)).length >= 2) return "viewer";
  if (
    nodes.some(
      (node) =>
        EDITABLE.test(node.role) &&
        text(node).length > 0 &&
        text(node).toLocaleLowerCase() !== (node.identifier ?? "").toLocaleLowerCase(),
    )
  )
    return "draft";
  for (const intent of intents) {
    const trimmed = intent.trim();
    if (/^wait (?:until|for)\b/iu.test(trimmed)) return "result";
    const sent = /^tap\s+[“"](send|submit|post)\s*([^”"]*)[”"]/iu.exec(trimmed);
    if (sent) return sent[2]!.trim() ? `${sent[2]!.trim().toLocaleLowerCase()} sent` : "sent";
    if (/^(?:type|enter|fill)\b/iu.test(trimmed)) return "draft";
  }
  return undefined;
}

/** Title for a screen created from one move, before the map knows more. */
export function newScreenTitle(input: {
  sourceTitle?: string;
  nodes?: readonly ScreenNamingNode[];
  intent?: string;
}): string {
  const area = input.sourceTitle?.trim() && !isPlaceholderScreenTitle(input.sourceTitle)
    ? input.sourceTitle.trim()
    : undefined;
  const state = screenStateWord(input.nodes ?? [], input.intent ? [input.intent] : []);
  if (area && state) return `${area} ${state}`;
  if (state) return capitalize(state);
  return area ? `After ${area}` : "Unnamed screen";
}

function tapLabelOf(intent: string | undefined): string | undefined {
  return /^tap\s+[“"]([^”"]+)[”"]/iu.exec(intent?.trim() ?? "")?.[1]?.trim();
}

/** Display names keyed by screen id, for every screen (named ones unchanged). */
export function screenDisplayNames(input: ScreenNamingInput): Map<string, string> {
  const byId = new Map(input.screens.map((screen) => [screen.id, screen]));
  const incoming = new Map<string, ScreenNamingInput["paths"][number][]>();
  for (const path of input.paths) {
    if (path.from === path.to || !byId.has(path.from) || !byId.has(path.to)) continue;
    incoming.set(path.to, [...(incoming.get(path.to) ?? []), path]);
  }
  const entries = new Set(
    input.entryIds?.length
      ? input.entryIds
      : input.screens.filter((screen) => !incoming.has(screen.id)).map((screen) => screen.id),
  );
  const labelsOf = (id: string) =>
    new Set(byId.get(id)!.nodes.map((node) => text(node).toLocaleLowerCase()).filter(Boolean));

  // Named after the control that opened it: "Send prompt", "Show navigation drawer".
  const actionNamed = (id: string) => {
    const title = byId.get(id)!.title.trim();
    if (!ACTION_VERB.test(title)) return false;
    return (incoming.get(id) ?? []).some((path) =>
      [tapLabelOf(path.label), ...(path.tapLabels ?? [])].some(
        (label) => label?.toLocaleLowerCase() === title.toLocaleLowerCase(),
      ),
    );
  };
  const generic = new Set(
    input.screens
      .filter(
        (screen) =>
          isPlaceholderScreenTitle(screen.title) ||
          (actionNamed(screen.id) && !LEADING_NAV_VERB.test(screen.title.trim())),
      )
      .map((screen) => screen.id),
  );
  const intentsOf = (id: string) =>
    (incoming.get(id) ?? []).flatMap((path) => (path.label ? [path.label] : []));
  const states = new Map<string, string | undefined>();
  for (const id of generic) {
    const screen = byId.get(id)!;
    const state = screenStateWord(screen.nodes, intentsOf(id));
    // Named after its button, but nothing better is known: keep that name.
    if (!state && !isPlaceholderScreenTitle(screen.title)) generic.delete(id);
    else states.set(id, state);
  }

  // The area a screen belongs to: the furthest named screen behind it (never
  // past an entry) whose name is still visible on it. Otherwise a named screen
  // is its own area and a renamed one takes the area of the screen before it.
  const areas = new Map<string, string>();
  const areaOf = (id: string, visiting = new Set<string>()): string | undefined => {
    if (areas.has(id)) return areas.get(id);
    if (visiting.has(id)) return undefined;
    visiting.add(id);
    let result: string | undefined;
    if (!entries.has(id)) {
      const labels = labelsOf(id);
      const seen = new Set([id]);
      let frontier = [id];
      for (let depth = 1; frontier.length && depth <= 8; depth += 1) {
        const next: string[] = [];
        for (const current of frontier) {
          if (current !== id && entries.has(current)) continue;
          for (const path of incoming.get(current) ?? []) {
            if (seen.has(path.from)) continue;
            seen.add(path.from);
            next.push(path.from);
            const title = byId.get(path.from)!.title.trim();
            if (
              !generic.has(path.from) &&
              !entries.has(path.from) &&
              labels.has(title.toLocaleLowerCase())
            )
              result = title;
          }
        }
        frontier = next;
      }
    }
    if (!result && !generic.has(id)) result = byId.get(id)!.title.trim();
    for (const path of result ? [] : (incoming.get(id) ?? [])) {
      result = areaOf(path.from, visiting);
      if (result) break;
    }
    if (result) areas.set(id, result);
    return result;
  };

  const names = new Map<string, string>();
  for (const screen of input.screens) {
    const title = screen.title.trim();
    if (!generic.has(screen.id)) {
      // "Show navigation drawer" → "Navigation drawer".
      names.set(
        screen.id,
        actionNamed(screen.id) ? capitalize(title.replace(LEADING_NAV_VERB, "")) : title,
      );
      continue;
    }
    const state = states.get(screen.id);
    const area = areaOf(screen.id);
    names.set(
      screen.id,
      area && state
        ? `${area} ${state}`
        : state
          ? capitalize(state)
          : area
            ? `${area} step`
            : "Unnamed screen",
    );
  }

  // Siblings that would share a name get a detail of their own.
  const groups = new Map<string, string[]>();
  for (const [id, name] of names) {
    const key = name.toLocaleLowerCase();
    groups.set(key, [...(groups.get(key) ?? []), id]);
  }
  for (const ids of groups.values()) {
    const renamed = ids.filter((id) => generic.has(id));
    if (ids.length < 2 || !renamed.length) continue;
    const ordered = [...renamed].sort(
      (a, b) =>
        (byId.get(a)!.createdAt ?? 0) - (byId.get(b)!.createdAt ?? 0) || a.localeCompare(b),
    );
    ordered.forEach((id, index) => {
      const others = new Set(ids.filter((other) => other !== id).flatMap((other) => [...labelsOf(other)]));
      const detail = [...labelsOf(id)]
        .filter((label) => !others.has(label) && label.length >= 4 && !/<[^>]+>/u.test(label))
        .sort((a, b) => b.length - a.length)[0];
      const words = detail?.split(/\s+/u) ?? [];
      const short = words.slice(0, 4).join(" ") + (words.length > 4 ? "…" : "");
      names.set(id, short ? `${names.get(id)!} “${short}”` : `${names.get(id)!} ${index + 1}`);
    });
  }
  return names;
}

/** Display names for every screen of a saved App Map. */
export function appMapScreenDisplayNames(map: AppMap): Map<string, string> {
  const variants = map.screenVariants ?? {};
  const entryIds = [
    ...new Set(Object.values(map.flows ?? {}).map((flow) => flow.startScreenId)),
  ].filter((id) => map.screens[id]);
  return screenDisplayNames({
    screens: Object.values(map.screens).map((screen) => ({
      id: screen.id,
      title: screen.title,
      createdAt: screen.createdAt,
      nodes: (screen.variantIds ?? [])
        .map((id) => variants[id])
        .filter((variant) => variant !== undefined)
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .flatMap((variant) => variant.observation?.nodes ?? []),
    })),
    paths: Object.values(map.connections).flatMap((connection) =>
      connection.destination.kind === "screen"
        ? [
            {
              from: connection.fromScreenId,
              to: connection.destination.screenId,
              ...(connection.label ? { label: connection.label } : {}),
              tapLabels: (connection.actions ?? []).flatMap((action) =>
                action.kind === "tap"
                  ? [action.target.label, action.target.text].filter(
                      (value): value is string => Boolean(value?.trim()),
                    )
                  : [],
              ),
            },
          ]
        : [],
    ),
    ...(entryIds.length ? { entryIds } : {}),
  });
}

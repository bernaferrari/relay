import type { AppMap, Connection } from "@relay/protocol";

export type IntentWalkMatch = {
  connectionId: string;
  label: string;
  fromScreenId: string;
  toScreenId?: string;
};

export type IntentWalkResult =
  | { status: "compiled"; intent: string; connectionIds: string[]; matches: IntentWalkMatch[] }
  | { status: "stuck"; intent: string; missing: string; matches: IntentWalkMatch[] };

function readyConnections(map: AppMap): Connection[] {
  return Object.values(map.connections).filter((connection) => connection.state === "ready");
}

function screenTitle(map: AppMap, screenId: string | undefined): string {
  return (screenId ? map.screens[screenId]?.title : undefined)?.trim() || "";
}

function connectionHaystack(map: AppMap, connection: Connection): string {
  const destinationId =
    connection.destination.kind === "screen" ? connection.destination.screenId : undefined;
  return [
    connection.label,
    screenTitle(map, connection.fromScreenId),
    screenTitle(map, destinationId),
  ]
    .filter(Boolean)
    .join(" ")
    .toLocaleLowerCase();
}

function tokens(intent: string): string[] {
  return intent
    .toLocaleLowerCase()
    .split(/[^a-z0-9]+/i)
    .map((token) => token.trim())
    .filter((token) => token.length > 2 && !["the", "and", "for", "with", "this"].includes(token));
}

/** Compile English onto existing ready connections. Missing edges stay Stuck. */
export function compileIntentWalk(map: AppMap, intent: string): IntentWalkResult {
  const requested = intent.trim();
  if (!requested) throw new Error("Intent is required");
  const words = tokens(requested);
  const matchConnection = (connection: Connection): IntentWalkMatch[] => {
    const haystack = connectionHaystack(map, connection);
    const hit =
      haystack.includes(requested.toLocaleLowerCase()) ||
      (words.length > 0 && words.every((word) => haystack.includes(word)));
    if (!hit) return [];
    return [
      {
        connectionId: connection.id,
        label: connection.label?.trim() || connection.id,
        fromScreenId: connection.fromScreenId,
        ...(connection.destination.kind === "screen"
          ? { toScreenId: connection.destination.screenId }
          : {}),
      },
    ];
  };
  const matches = readyConnections(map).flatMap(matchConnection);
  if (!matches.length) {
    const seen = Object.values(map.connections)
      .filter((connection) => connection.state === "draft")
      .flatMap(matchConnection);
    const seenLabel = seen[0]?.label;
    return {
      status: "stuck",
      intent: requested,
      missing: seenLabel
        ? `“${requested}” is on the map as a draft (${seenLabel}). Keep it before a Test can run.`
        : `No App Map edge matches “${requested}”. Start mapping to explore that path.`,
      matches: [],
    };
  }
  return {
    status: "compiled",
    intent: requested,
    connectionIds: matches.map((match) => match.connectionId),
    matches,
  };
}

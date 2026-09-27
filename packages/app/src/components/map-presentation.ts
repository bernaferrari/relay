import type { ProductMapPath, ProductMapScreen } from "@relay/product/map-exploration";

export type PresentedMapPath = ProductMapPath & {
  readonly intermediateScreens?: readonly ProductMapScreen[];
};

/** Fold only unambiguous typing states. The saved map and its paths stay intact. */
export function compactMap(
  screens: readonly ProductMapScreen[],
  paths: readonly ProductMapPath[],
  protectedScreenId?: string,
  protectedPathId?: string,
) {
  let remaining = [...screens];
  let connections: PresentedMapPath[] = [...paths];
  for (const screen of screens) {
    if (screen.id === protectedScreenId || screen.recentFailures.length) continue;
    const incoming = connections.filter((path) => path.toScreenId === screen.id);
    const outgoing = connections.filter((path) => path.fromScreenId === screen.id);
    if (incoming.length !== 1 || outgoing.length !== 1) continue;
    const before = incoming[0]!;
    const after = outgoing[0]!;
    if (
      after.id === protectedPathId ||
      !before.actionKinds?.includes("type") ||
      !before.actionKinds.every((kind) => kind === "type" || kind === "wait-for") ||
      !after.toScreenId ||
      after.toScreenId === before.fromScreenId ||
      after.toScreenId === screen.id ||
      !remaining.some((candidate) => candidate.id === after.toScreenId)
    )
      continue;
    const joined: PresentedMapPath = {
      ...before,
      toScreenId: after.toScreenId,
      toTitle: after.toTitle,
      label: `${before.label} → ${after.label}`,
      actionKinds: [...before.actionKinds, ...(after.actionKinds ?? [])],
      intermediateScreens: [
        ...(before.intermediateScreens ?? []),
        screen,
        ...(after.intermediateScreens ?? []),
      ],
    };
    connections = connections
      .filter((path) => path.id !== after.id)
      .map((path) => (path.id === before.id ? joined : path));
    remaining = remaining.filter((candidate) => candidate.id !== screen.id);
  }
  return { screens: remaining, paths: connections };
}

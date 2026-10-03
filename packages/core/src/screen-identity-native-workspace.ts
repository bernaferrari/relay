import type { AppIdentityPolicy } from "./app-identity-policy.js";
import type { SnapshotNode } from "./device.js";

/** The reviewed Imagine canvas changes from templates to generated media.
 * Qualify its owned, selected workspace before removing that canvas; retain
 * all chrome and composer controls, including model selection and focus. */
export function nativeWorkspaceIdentityNodes(
  nodes: readonly SnapshotNode[],
  policy?: AppIdentityPolicy,
  options: { pendingModel?: boolean } = {},
): readonly SnapshotNode[] {
  const pack = policy?.nativeImagineWorkspace;
  if (!pack) return nodes;
  const visible = nodes.filter(
    (node) =>
      node.visibleToUser !== false &&
      node.bundleId !== "com.android.systemui" &&
      !/^(?:com\.google\.android\.inputmethod\.latin|com\.samsung\.android\.honeyboard|com\.touchtype\.swiftkey)$/u.test(
        node.bundleId ?? "",
      ),
  );
  if (
    visible.some((node) => node.bundleId !== pack.packageName || /dialog/iu.test(node.type ?? ""))
  )
    return nodes;
  const unique = (predicate: (node: SnapshotNode) => boolean): SnapshotNode | undefined => {
    const found = visible.filter(predicate);
    return found.length === 1 ? found[0] : undefined;
  };
  const root = unique((node) => node.identifier === `${pack.packageName}:id/action_bar_root`);
  const header = unique((node) => node.identifier === "conversation_top_bar");
  if (
    !root?.rect ||
    !header?.rect ||
    header.rect.y !== 0 ||
    header.rect.height > root.rect.height * 0.2
  )
    return nodes;
  const headerBottom = header.rect.y + header.rect.height;
  const inHeader = (node: SnapshotNode): boolean =>
    Boolean(node.rect && node.rect.y >= 0 && node.rect.y + node.rect.height <= headerBottom);
  const tab = unique((node) => node.label === "Imagine" && inHeader(node));
  const selectedTab = visible.find((node) => node.index === tab?.parentIndex);
  if (!tab || !selectedTab?.selected || selectedTab.enabled === false || !inHeader(selectedTab))
    return nodes;
  for (const label of ["Ask", "Build", "Show navigation drawer", "Refresh"]) {
    if (!unique((node) => node.label === label && node.enabled !== false && inHeader(node)))
      return nodes;
  }
  const input = unique((node) => node.type === "android.widget.EditText");
  const attach = unique((node) => node.label === "Attach media" && node.enabled !== false);
  if (!input?.rect || !attach?.rect || input.enabled === false) return nodes;
  let composerTop: number;
  const composer = visible.find((node) => node.index === input.parentIndex);
  if (!composer || composer.index === undefined) return nodes;
  const byIndex = new Map(visible.map((node) => [node.index, node]));
  const belongsToComposer = (node: SnapshotNode): boolean => {
    let current: SnapshotNode | undefined = node;
    for (let depth = 0; current && depth < 64; depth += 1) {
      if (current.index === composer.index) return true;
      current = byIndex.get(current.parentIndex);
    }
    return false;
  };
  let modelParents: Array<SnapshotNode | undefined> = [];
  let quality: SnapshotNode | undefined;
  let count: SnapshotNode | undefined;
  if (input.focused === true) {
    const send = unique((node) => node.label === "Send prompt");
    count = unique((node) => node.label === "Image count");
    const speed = unique((node) => node.label === "Speed");
    quality = unique((node) => /^Quality(?:\s|$)/iu.test(node.label ?? ""));
    if (!send?.rect || !count?.rect || !speed?.rect || !quality?.rect) return nodes;
    modelParents = [speed, quality].map((node) =>
      visible.find((parent) => parent.index === node.parentIndex),
    );
    if (modelParents.filter((node) => node?.selected).length !== 1) return nodes;
    if (![speed, quality, count, attach, send].every(belongsToComposer)) return nodes;
    composerTop = Math.min(...modelParents.map((node) => node?.rect?.y ?? Infinity));
  } else {
    const placeholder = unique((node) => node.label === "Type to imagine");
    const settings = unique((node) => node.label === "Imagine settings" && node.enabled !== false);
    const favorites = unique((node) => node.label === "Favorites");
    if (!placeholder?.rect || !settings?.rect || !favorites?.rect || input.value?.trim())
      return nodes;
    composerTop = Math.min(input.rect.y, attach.rect.y, settings.rect.y, favorites.rect.y);
    if (
      composerTop < root.rect.height * 0.7 ||
      visible.filter((node) => node.selected).length !== 1
    )
      return nodes;
  }
  if (!Number.isFinite(composerTop) || composerTop <= headerBottom) return nodes;
  const retained = visible.filter(
    (node) =>
      (node === root || inHeader(node) || belongsToComposer(node)) &&
      Boolean(
        node.label ||
        node.value ||
        node.identifier ||
        node.selected ||
        node === input ||
        modelParents.includes(node) ||
        /(?:Button|Spinner)$/u.test(node.type ?? ""),
      ),
  );
  return retained.map((node) => {
    // An unselected model's version badge is unavailable-model chrome, not
    // proof of the selected model. Selected Quality keeps its exact label.
    if (node === quality && (options.pendingModel || !modelParents[1]?.selected))
      return { ...node, label: "Quality", value: "Quality" };
    if (options.pendingModel && modelParents.includes(node)) return { ...node, selected: false };
    if (
      options.pendingModel &&
      count &&
      node !== count &&
      node.parentIndex === count.parentIndex &&
      /^(?:Auto|x\s+\d+)$/u.test(node.label ?? "")
    )
      return { ...node, label: "Model image count", value: "Model image count" };
    return node;
  });
}

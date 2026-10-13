import {
  isActionScreenTitle,
  newScreenTitle,
  type AuthoringObservation,
  type RecipeStep,
} from "@relay/protocol";

export function capturedScreenTitle(observation?: AuthoringObservation): string | undefined {
  const candidates = (observation?.nodes ?? []).flatMap((node, index) => {
    const role = String(node.role ?? node.type ?? "");
    const identifier = typeof node.identifier === "string" ? node.identifier : "";
    const htmlHeading = /^h([1-6])$/iu.exec(role);
    const heading =
      /navigation\s*bar|header|heading/i.test(role) ||
      Boolean(htmlHeading) ||
      node.heading === true ||
      node.isHeading === true;
    const parent = observation?.nodes?.find((candidate) => candidate.index === node.parentIndex);
    const parentId = typeof parent?.identifier === "string" ? parent.identifier : "";
    const toolbar =
      /:id\/(?:collapsing_toolbar|(?:custom_)?toolbar_title|action_bar_title)$/u.test(identifier) ||
      /:id\/(?:toolbar|action_bar)$/u.test(parentId);
    if (!heading && !toolbar) return [];
    if (node.bundleId === "com.android.systemui" || node.visibleToUser === false) return [];
    const title = [node.label, node.text, node.value].find(
      (value) => typeof value === "string" && value.trim(),
    ) as string | undefined;
    if (!title || title.length > 120 || /^(?:back|navigate up)$/iu.test(title.trim())) return [];
    return [
      {
        title: title.trim(),
        rank: toolbar ? 0 : htmlHeading ? Number(htmlHeading[1]) : heading ? 1 : 2,
        index,
      },
    ];
  });
  return candidates.sort((a, b) => a.rank - b.rank || a.index - b.index)[0]?.title;
}

/** Never "Next screen": a heading, a noun-like control, or the area plus what it shows. */
export function newDestinationTitle(input: {
  observed: string | undefined;
  steps: readonly RecipeStep[];
  after?: AuthoringObservation;
  sourceTitle: string;
}): string {
  // A heading on the screen always wins; a tapped control's label only when it reads as a name.
  if (input.observed && input.observed === capturedScreenTitle(input.after)) return input.observed;
  if (input.observed && !isActionScreenTitle(input.observed)) return input.observed;
  const last = input.steps.at(-1);
  const intent =
    last?.kind === "tap"
      ? `Tap “${last.target.label ?? last.target.text ?? last.target.identifier ?? ""}”`
      : last?.kind === "type"
        ? "Type text"
        : last?.kind === "wait-for"
          ? "Wait until it appears"
          : undefined;
  return newScreenTitle({
    sourceTitle: input.sourceTitle,
    nodes: (input.after?.nodes ?? []).map((node) => {
      const label = node.label ?? node.text;
      return {
        role: String(node.role ?? node.type ?? ""),
        ...(typeof label === "string" ? { label } : {}),
        ...(typeof node.identifier === "string" ? { identifier: node.identifier } : {}),
      };
    }),
    ...(intent ? { intent } : {}),
  });
}

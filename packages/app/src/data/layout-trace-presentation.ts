type RecordValue = Record<string, unknown>;

export type LayoutTracePresentation = {
  title: string;
  failure?: { kind: "layout-overlap"; cause: string; summary: string; technicalDetail: string };
};

function record(value: unknown): RecordValue | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as RecordValue)
    : undefined;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function sameTarget(left: unknown, right: unknown): boolean {
  const a = record(left);
  const b = record(right);
  if (!a || !b) return false;
  const keys = Object.keys(a);
  return (
    keys.length === Object.keys(b).length &&
    keys.every((key) => (record(a[key]) ? sameTarget(a[key], b[key]) : a[key] === b[key]))
  );
}

function observedName(target: unknown, nodes: unknown[]): string | undefined {
  const selector = record(target);
  if (!selector) return undefined;
  const field = ["identifier", "ref", "label", "text"].find((key) => text(selector[key]));
  if (!field) return undefined;
  const matches = nodes.flatMap((value) => {
    const node = record(value);
    if (!node || node.visibleToUser === false || node.enabled === false) return [];
    if (
      selector.role &&
      text(node.role ?? node.type)?.toLowerCase() !== text(selector.role)?.toLowerCase()
    )
      return [];
    const expected = text(selector[field])!;
    const actual = text(node[field]);
    const matches =
      field === "ref"
        ? actual?.replace(/^@/u, "") === expected.replace(/^@/u, "")
        : field === "text"
          ? [node.content, node.label, node.value].some((value) =>
              text(value)?.toLowerCase().includes(expected.toLowerCase()),
            )
          : actual === expected;
    return matches ? [node] : [];
  });
  // A name from another element or another check is not evidence for this one.
  return matches.length === 1 ? text(matches[0]!.label) : undefined;
}

function positiveOverlap(value: unknown): boolean {
  const bounds = record(value);
  return Boolean(
    bounds &&
    ["x", "y", "width", "height"].every(
      (key) => typeof bounds[key] === "number" && Number.isFinite(bounds[key]),
    ) &&
    (bounds.width as number) > 0 &&
    (bounds.height as number) > 0,
  );
}

/** Presentation joins the exact trace command to its retained tree. Legacy
 * layout artifacts have no step ID, so only the command's own artifact window
 * may supply its result; later assertions cannot rename an earlier failure. */
export function layoutTracePresentation(
  rawRun: unknown,
  traceStepId: string,
  rawTitle: string,
): LayoutTracePresentation | undefined {
  const artifacts = record(rawRun)?.artifacts;
  if (!Array.isArray(artifacts)) return undefined;
  const commands = artifacts.flatMap((value, index) => {
    const artifact = record(value);
    const data = record(artifact?.data);
    return artifact?.kind === "command-attempt" && data?.stepId === traceStepId
      ? [{ index, command: record(data.command) }]
      : [];
  });
  if (commands.length !== 1) return undefined;
  const { index, command } = commands[0]!;
  if (command?.kind !== "assert-layout" || command.relation !== "non-overlap") return undefined;
  const nextCommand = artifacts.findIndex(
    (value, candidate) => candidate > index && record(value)?.kind === "command-attempt",
  );
  const window = artifacts.slice(index + 1, nextCommand < 0 ? undefined : nextCommand);
  const trees = window.flatMap((value) => {
    const artifact = record(value);
    const data = record(artifact?.data);
    return artifact?.kind === "ui-tree" &&
      data?.stepId === traceStepId &&
      data.phase === "after" &&
      data.status !== "failed" &&
      Array.isArray(data.nodes)
      ? [data.nodes]
      : [];
  });
  const nodes = trees.length === 1 ? trees[0]! : [];
  const first = observedName(command.first, nodes);
  const second = observedName(command.second, nodes);
  const names = first && second ? `${first} and ${second}` : undefined;
  const title = names ? `Check ${names} do not overlap` : "Check elements do not overlap";
  const failures = window.flatMap((value) => {
    const artifact = record(value);
    const data = record(artifact?.data);
    return artifact?.kind === "layout-assertion" &&
      data?.relation === "non-overlap" &&
      data.passed === false &&
      sameTarget(data.first, command.first) &&
      sameTarget(data.second, command.second) &&
      positiveOverlap(data.overlap) &&
      /\boverlaps\b/iu.test(text(data.error) ?? "")
      ? [data]
      : [];
  });
  return {
    title,
    ...(failures.length === 1
      ? {
          failure: {
            kind: "layout-overlap",
            cause: text(failures[0]!.error)!,
            summary: names ? `${names} overlap.` : "The two elements overlap.",
            technicalDetail: `${rawTitle}\n${text(failures[0]!.error)!}`,
          },
        }
      : {}),
  };
}

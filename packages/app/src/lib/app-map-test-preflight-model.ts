import type { OfflineTestPreflightFinding } from "@relay/protocol";

export type PreflightFindingGroup = {
  id: "evidence" | "selectors" | "surface" | "returns" | "variants";
  title: string;
  action: string;
  findings: OfflineTestPreflightFinding[];
};

function groupFor(finding: OfflineTestPreflightFinding): PreflightFindingGroup["id"] {
  switch (finding.code) {
    case "raw-evidence-recapture-required":
    case "source-observation-missing":
    case "selector-needs-raw-tree":
      return "evidence";
    case "raw-evidence-variant-selection-required":
    case "raw-evidence-variant-recapture-required":
      return "variants";
    case "selector-absent":
    case "selector-ambiguous":
    case "point-only-selector":
      return "selectors";
    case "surface-recapture-required":
      return "surface";
    case "unresolved-return":
      return "returns";
  }
}

const copy: Record<PreflightFindingGroup["id"], Omit<PreflightFindingGroup, "findings">> = {
  evidence: {
    id: "evidence",
    title: "Refresh saved evidence",
    action:
      "Capture the named screen once when a device is available. Until then, Relay will not guess its geometry.",
  },
  selectors: {
    id: "selectors",
    title: "Review selectors",
    action: "Choose a semantic target or explicitly keep a reviewed fallback before running.",
  },
  variants: {
    id: "variants",
    title: "Choose a target variant",
    action:
      "Choose an Evidence profile in the Test toolbar, then recapture or retarget only the named variant. Relay will not infer a locale from visible copy.",
  },
  surface: {
    id: "surface",
    title: "Refresh full-page evidence",
    action: "Recapture this logical page from its proven origin before comparing it.",
  },
  returns: {
    id: "returns",
    title: "Teach a return",
    action: "Add the reviewed reverse connection; Relay will never invent a Back path.",
  },
};

/** Collapse raw diagnostics into a small, action-oriented review queue. We do
 * not discard per-step evidence—the group remains expandable—but a 40-screen
 * Test should lead with the next repair class, not a wall of warnings. */
export function groupPreflightFindings(
  findings: readonly OfflineTestPreflightFinding[],
): PreflightFindingGroup[] {
  const grouped = new Map<PreflightFindingGroup["id"], OfflineTestPreflightFinding[]>();
  for (const finding of findings) {
    const id = groupFor(finding);
    const existing = grouped.get(id) ?? [];
    const duplicate = existing.some(
      (candidate) =>
        candidate.code === finding.code &&
        candidate.screenId === finding.screenId &&
        candidate.recipeStepId === finding.recipeStepId,
    );
    if (!duplicate) existing.push(finding);
    grouped.set(id, existing);
  }
  return (["returns", "selectors", "variants", "surface", "evidence"] as const).flatMap((id) => {
    const findings = grouped.get(id);
    return findings?.length ? [{ ...copy[id], findings }] : [];
  });
}

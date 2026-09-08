export type RecordingEvidenceTarget = {
  identifier?: string;
  label?: string;
  text?: string;
};

export type RecordingEvidenceControl = {
  id: string;
  name: string;
  role?: string;
  rect: { x: number; y: number; width: number; height: number };
  target: RecordingEvidenceTarget;
  why: string;
};

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function rectOf(value: unknown): RecordingEvidenceControl["rect"] | undefined {
  if (!value || typeof value !== "object") return undefined;
  const rect = value as { x?: unknown; y?: unknown; width?: unknown; height?: unknown };
  if (
    typeof rect.x !== "number" ||
    typeof rect.y !== "number" ||
    typeof rect.width !== "number" ||
    typeof rect.height !== "number"
  ) {
    return undefined;
  }
  if (![rect.x, rect.y, rect.width, rect.height].every(Number.isFinite)) return undefined;
  if (rect.width <= 0 || rect.height <= 0) return undefined;
  return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
}

function contains(
  rect: RecordingEvidenceControl["rect"],
  point: { x: number; y: number },
): boolean {
  return (
    point.x >= rect.x &&
    point.y >= rect.y &&
    point.x <= rect.x + rect.width &&
    point.y <= rect.y + rect.height
  );
}

/** Project reviewable, pickable controls from a bound observation tree.
 * Raw node payloads stay inside this projector. */
export function projectRecordingEvidenceControls(
  nodes: readonly Record<string, unknown>[] | undefined,
): RecordingEvidenceControl[] {
  const controls: RecordingEvidenceControl[] = [];
  for (const [index, node] of (nodes ?? []).entries()) {
    if (node.visibleToUser === false) continue;
    const rect = rectOf(node.rect);
    if (!rect) continue;
    const identifier = text(node.identifier);
    const label = text(node.label);
    const value = text(node.text ?? node.value);
    if (!identifier && !label && !value) continue;
    const role = text(node.role ?? node.type);
    const target: RecordingEvidenceTarget = identifier
      ? { identifier }
      : label
        ? { label }
        : { text: value };
    const name = label ?? value ?? identifier ?? `Control ${index + 1}`;
    const why = identifier
      ? `Matched the stable identifier ${identifier}.`
      : label
        ? `Matched the visible name “${label}”.`
        : `Matched the visible text “${value}”.`;
    controls.push({
      id: `${identifier ?? label ?? value}:${index}`,
      name,
      ...(role ? { role } : {}),
      rect,
      target,
      why,
    });
  }
  return controls.sort(
    (left, right) => left.rect.width * left.rect.height - right.rect.width * right.rect.height,
  );
}

/** Smallest control that contains the click. */
export function pickRecordingEvidenceControl(
  controls: readonly RecordingEvidenceControl[],
  point: { x: number; y: number },
): RecordingEvidenceControl | undefined {
  let match: RecordingEvidenceControl | undefined;
  let area = Number.POSITIVE_INFINITY;
  for (const control of controls) {
    if (!contains(control.rect, point)) continue;
    const next = control.rect.width * control.rect.height;
    if (next < area) {
      match = control;
      area = next;
    }
  }
  return match;
}

export function controlsForAuthoringEvidence(
  revision:
    | {
        observations?: readonly {
          evidenceIds?: readonly string[];
          nodes?: Record<string, unknown>[];
        }[];
        before?: { evidenceIds?: readonly string[]; nodes?: Record<string, unknown>[] };
        after?: { evidenceIds?: readonly string[]; nodes?: Record<string, unknown>[] };
      }
    | undefined,
  evidenceId: string,
): RecordingEvidenceControl[] {
  const wanted = evidenceId.trim();
  if (!wanted || !revision) return [];
  const observations = [
    ...(revision.observations ?? []),
    ...(revision.before ? [revision.before] : []),
    ...(revision.after ? [revision.after] : []),
  ];
  const match = observations.find((observation) => observation.evidenceIds?.includes(wanted));
  return projectRecordingEvidenceControls(match?.nodes);
}

export function imagePointFromClick(
  event: { clientX: number; clientY: number },
  image: { getBoundingClientRect(): DOMRect; naturalWidth: number; naturalHeight: number },
): { x: number; y: number } | undefined {
  const box = image.getBoundingClientRect();
  if (box.width <= 0 || box.height <= 0 || image.naturalWidth <= 0 || image.naturalHeight <= 0) {
    return undefined;
  }
  const scale = Math.min(box.width / image.naturalWidth, box.height / image.naturalHeight);
  const drawnWidth = image.naturalWidth * scale;
  const drawnHeight = image.naturalHeight * scale;
  const offsetX = box.left + (box.width - drawnWidth) / 2;
  const offsetY = box.top + (box.height - drawnHeight) / 2;
  const x = (event.clientX - offsetX) / scale;
  const y = (event.clientY - offsetY) / scale;
  if (x < 0 || y < 0 || x > image.naturalWidth || y > image.naturalHeight) return undefined;
  return { x, y };
}

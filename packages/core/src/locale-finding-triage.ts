/**
 * Locale findings a person has accepted.
 *
 * A locale sweep is only worth reading twice if the second read is quieter than
 * the first. Every check in corpus-report is a heuristic over labels, so a
 * genuinely known defect — a German label that has always been two characters
 * too long for its button — arrives again on every sweep, in every language, for
 * as long as it exists. Forty languages of that is forty reasons to stop looking
 * at the grid.
 *
 * The store is deliberately the smallest thing that fixes it: a set of finding
 * ids, and the sentence the finding used when it was accepted so the list reads
 * as prose. Not an issue tracker — no assignee, no status beyond known or not,
 * nothing that has to be kept in step with anything else. Findings are keyed by
 * `CorpusFinding.id`, which the analyzer derives from the code, the screen, the
 * locale and the control rather than from the sweep, so acceptance survives the
 * next sweep of the same screens.
 */
import type { CorpusFinding, KnownLocaleFinding } from "@relay/protocol";
import { readWorkspaceSetting, writeWorkspaceSetting } from "./workspace-settings.js";

const KNOWN_FINDINGS_FILE = "locale-known-findings.json";

type StoredKnownFindings = {
  version: 1;
  findings: KnownLocaleFinding[];
};

function isStored(value: unknown): value is StoredKnownFindings {
  const record = value as StoredKnownFindings | null;
  return Boolean(record && record.version === 1 && Array.isArray(record.findings));
}

/** Newest first: a list a person scans is a list of what they did last. */
export async function listKnownLocaleFindings(): Promise<KnownLocaleFinding[]> {
  const raw = await readWorkspaceSetting(KNOWN_FINDINGS_FILE);
  if (!isStored(raw)) return [];
  return raw.findings
    .filter((finding) => typeof finding?.id === "string" && finding.id.length > 0)
    .sort((left, right) => right.markedAt - left.markedAt);
}

/**
 * Accept a finding. Re-accepting one that is already known refreshes its note
 * rather than adding a second row, because the id is the identity.
 */
export async function markLocaleFindingKnown(input: {
  finding: Pick<
    CorpusFinding,
    "id" | "code" | "canonicalKey" | "screenLabel" | "locale" | "detail" | "stableKey"
  >;
  note?: string;
  markedBy?: string;
}): Promise<KnownLocaleFinding> {
  const { finding } = input;
  if (!finding?.id?.trim()) throw new Error("finding id is required");
  const note = input.note?.trim();
  const markedBy = input.markedBy?.trim();
  const known: KnownLocaleFinding = {
    id: finding.id.trim(),
    code: finding.code,
    canonicalKey: finding.canonicalKey,
    screenLabel: finding.screenLabel,
    locale: finding.locale,
    detail: finding.detail,
    markedAt: Date.now(),
    ...(finding.stableKey ? { stableKey: finding.stableKey } : {}),
    ...(note ? { note } : {}),
    ...(markedBy ? { markedBy } : {}),
  };
  const current = await listKnownLocaleFindings();
  await writeWorkspaceSetting(KNOWN_FINDINGS_FILE, {
    version: 1,
    findings: [known, ...current.filter((item) => item.id !== known.id)],
  } satisfies StoredKnownFindings);
  return known;
}

/** Put a finding back in the queue. Unknown ids are not an error: the caller
 * wanted it gone, and it is. */
export async function forgetKnownLocaleFinding(findingId: string): Promise<KnownLocaleFinding[]> {
  const id = findingId.trim();
  const current = await listKnownLocaleFindings();
  const next = current.filter((item) => item.id !== id);
  if (next.length !== current.length) {
    await writeWorkspaceSetting(KNOWN_FINDINGS_FILE, {
      version: 1,
      findings: next,
    } satisfies StoredKnownFindings);
  }
  return next;
}

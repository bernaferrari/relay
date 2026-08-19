import type {
  CorpusAnalysisReport,
  CorpusCoverageReport,
  CorpusFinding,
  CorpusSession,
  KnownLocaleFinding,
  OperationId,
  OperationInput,
  OperationOutput,
} from "@relay/protocol";

/**
 * The locale sweep, over the operation contract.
 *
 * `corpus.*` is registered as an operation, so the UI reaches it the way
 * AGENTS.md says a UI reaches domain logic — through `runAction` — rather than
 * through a private HTTP path. The corpus operations carry no response parser,
 * which is why every cast in the app lives here instead of being sprinkled
 * across the review surface.
 */
export type RunOperation = <Id extends OperationId>(
  id: Id,
  input: OperationInput<Id>,
) => Promise<OperationOutput<Id>>;

/** One row of a scanned picker: a language and how to choose it. */
export type SwitcherOptionSummary = { id: string; label: string };

/** A scanned switcher — the app plus the path that changes its language. */
export type LanguageSwitcherSummary = {
  id: string;
  name: string;
  app: string;
  platform?: "ios" | "android" | "any";
  options: SwitcherOptionSummary[];
  scanned?: boolean;
};

export async function listCorpusSweeps(run: RunOperation): Promise<CorpusSession[]> {
  const body = (await run("corpus.list", {})) as { sessions?: CorpusSession[] };
  return body.sessions ?? [];
}

export async function readCorpusSweep(
  run: RunOperation,
  sessionId: string,
): Promise<CorpusSession> {
  const body = (await run("corpus.get", { sessionId })) as { session: CorpusSession };
  return body.session;
}

export async function readCorpusCoverage(
  run: RunOperation,
  sessionId: string,
): Promise<CorpusCoverageReport> {
  const body = (await run("corpus.coverage", { sessionId })) as {
    coverage: CorpusCoverageReport;
  };
  return body.coverage;
}

export async function readCorpusAnalysis(
  run: RunOperation,
  sessionId: string,
): Promise<CorpusAnalysisReport> {
  const body = (await run("corpus.analysis", { sessionId })) as { analysis: CorpusAnalysisReport };
  return body.analysis;
}

export async function startCorpusSweep(
  run: RunOperation,
  sessionId: string,
): Promise<CorpusSession> {
  const body = (await run("corpus.start", { sessionId })) as { session: CorpusSession };
  return body.session;
}

export async function stopCorpusSweep(
  run: RunOperation,
  sessionId: string,
): Promise<CorpusSession> {
  const body = (await run("corpus.cancel", { sessionId })) as { session: CorpusSession };
  return body.session;
}

/**
 * Findings a person already accepted, workspace-wide.
 *
 * Not per sweep on purpose: the whole point is that the next sweep of the same
 * screens inherits them, so a forty-language re-run reports what changed rather
 * than everything it can see.
 */
export async function listKnownFindings(run: RunOperation): Promise<KnownLocaleFinding[]> {
  const body = (await run("locale-finding.known.list", {})) as {
    findings?: KnownLocaleFinding[];
  };
  return body.findings ?? [];
}

export async function markFindingKnown(
  run: RunOperation,
  finding: CorpusFinding,
  note?: string,
): Promise<KnownLocaleFinding[]> {
  const body = (await run("locale-finding.known.add", {
    finding,
    ...(note?.trim() ? { note: note.trim() } : {}),
  })) as { findings?: KnownLocaleFinding[] };
  return body.findings ?? [];
}

export async function forgetKnownFinding(
  run: RunOperation,
  findingId: string,
): Promise<KnownLocaleFinding[]> {
  const body = (await run("locale-finding.known.remove", { findingId })) as {
    findings?: KnownLocaleFinding[];
  };
  return body.findings ?? [];
}

export async function listLanguageSwitchers(run: RunOperation): Promise<LanguageSwitcherSummary[]> {
  const body = (await run("switcher-profile.list", { kind: "language" })) as {
    profiles?: LanguageSwitcherSummary[];
  };
  return body.profiles ?? [];
}

/**
 * Create a sweep from a scanned picker. The server turns `switcherProfileId`
 * into the entry path, the picker path and the per-locale rows, so the UI never
 * has to know how a given app changes its language.
 */
export async function createCorpusSweep(
  run: RunOperation,
  input: { name: string; targetId: string; switcherProfileId: string; locales: string[] },
): Promise<CorpusSession> {
  const body = (await run("corpus.create", {
    name: input.name,
    targetId: input.targetId,
    scope: { switcherProfileId: input.switcherProfileId, locales: input.locales },
  })) as { session: CorpusSession };
  return body.session;
}

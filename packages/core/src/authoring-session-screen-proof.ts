import { randomUUID } from "node:crypto";
import {
  describeSnapshotChrome,
  type AuthoringCommitDestination,
  type AuthoringObservation,
  type AuthoringReplayAttempt,
  type AuthoringSession,
  type AuthoringTakeRevision,
  type ScreenIdentityObservation,
} from "@relay/protocol";
import { readAppMap } from "./collaboration.js";
import type { SnapshotNode } from "./device.js";
import { now } from "./events.js";
import { AuthoringStateError } from "./authoring-session-state.js";
import {
  compareScreenIdentity,
  observeScreenIdentity,
  resolveScreenIdentity,
} from "./screen-identity.js";

/** Returns the exact immutable Take revision currently under review. */
export function currentRevision(session: AuthoringSession): AuthoringTakeRevision {
  const take = session.take;
  const revision = take?.revisions.find((item) => item.revision === take.currentRevision);
  if (!take || !revision) throw new AuthoringStateError("Authoring Session has no current Take");
  return revision;
}

export async function expectedReplayScreen(
  session: AuthoringSession,
  revision: AuthoringTakeRevision,
): Promise<{ fingerprints: string[]; observations: ScreenIdentityObservation[]; title?: string }> {
  const appMap = await readAppMap(session.projectId, session.appMapId);
  if (!appMap) throw new AuthoringStateError("App Map no longer exists");
  const configured =
    session.destination ??
    (session.pendingConnectionId
      ? appMap.connections[session.pendingConnectionId]?.destination
      : undefined);
  if (configured?.kind === "end") return { fingerprints: [], observations: [] };
  if (configured?.kind === "screen") {
    const screen = appMap.screens[configured.screenId];
    if (!screen) throw new AuthoringStateError("Expected destination screen no longer exists");
    const fingerprints = [
      screen.identity?.fingerprint,
      ...(screen.identity?.aliases ?? []),
      ...screen.variantIds.flatMap((variantId) => {
        const fingerprint = appMap.screenVariants[variantId]?.observation?.fingerprint;
        return fingerprint ? [fingerprint] : [];
      }),
    ].filter((fingerprint): fingerprint is string => Boolean(fingerprint));
    // A planned destination intentionally has no identity yet. Its recorded
    // final observation is still authoritative and must be verified before
    // the placeholder can become a real screen.
    const observations = screen.variantIds.flatMap((variantId) => {
      const observation = appMap.screenVariants[variantId]?.observation;
      return observation ? [observation] : [];
    });
    if (fingerprints.length > 0 || observations.length > 0) {
      return { fingerprints, observations, title: screen.title };
    }
    const fallback = revision.reason === "recording" ? revision.after : undefined;
    const semantic = semanticObservation(fallback);
    return {
      fingerprints: fallback?.screen.fingerprint ? [fallback.screen.fingerprint] : [],
      observations: semantic ? [semantic] : [],
      title: screen.title,
    };
  }
  const semantic = semanticObservation(revision.after);
  return {
    fingerprints: revision.after?.screen.fingerprint ? [revision.after.screen.fingerprint] : [],
    observations: semantic ? [semantic] : [],
  };
}

async function expectedSourceScreen(session: AuthoringSession): Promise<{
  title: string;
  fingerprints: string[];
  observations: ScreenIdentityObservation[];
} | null> {
  const appMap = await readAppMap(session.projectId, session.appMapId);
  if (!appMap) throw new AuthoringStateError("App Map no longer exists");
  const sourceScreenId =
    session.sourceScreenId ??
    (session.pendingConnectionId
      ? appMap.connections[session.pendingConnectionId]?.fromScreenId
      : undefined);
  if (!sourceScreenId) return null;
  const screen = appMap.screens[sourceScreenId];
  if (!screen) throw new AuthoringStateError("Source screen no longer exists");
  const fingerprints = [
    screen.identity?.fingerprint,
    ...(screen.identity?.aliases ?? []),
    ...screen.variantIds.flatMap((variantId) => {
      const fingerprint = appMap.screenVariants[variantId]?.observation?.fingerprint;
      return fingerprint ? [fingerprint] : [];
    }),
  ].filter((fingerprint): fingerprint is string => Boolean(fingerprint));
  const observations = screen.variantIds.flatMap((variantId) => {
    const observation = appMap.screenVariants[variantId]?.observation;
    return observation ? [observation] : [];
  });
  return { title: screen.title, fingerprints: [...new Set(fingerprints)], observations };
}

function semanticObservation(
  observation: AuthoringObservation | undefined,
): ScreenIdentityObservation | undefined {
  // A delayed tree can still be retained as diagnostic evidence, but cannot
  // establish that a replay is on an expected screen. Legacy observations
  // predate proof metadata, so preserve their established behavior until they
  // are explicitly recaptured with a stale/unavailable semantic result.
  if (observation?.proof && observation.proof.semantics.status !== "current") return undefined;
  if (!observation?.nodes?.length) return undefined;
  return observeScreenIdentity(observation.nodes as SnapshotNode[]);
}

function semanticsMatch(
  observed: AuthoringObservation,
  expected: readonly ScreenIdentityObservation[],
): boolean {
  const semantic = semanticObservation(observed);
  if (!semantic || expected.length === 0) return false;
  return (
    resolveScreenIdentity(
      semantic,
      expected.map((observation, index) => ({ id: `expected-${index}`, observation })),
    ).kind === "existing"
  );
}

/**
 * A recorded destination may contain generated copy, timestamps, or remote
 * content that is expected to change on every replay. Exact semantics remain
 * the first choice, but the same stable application shell is also sufficient
 * when it has multiple matching identifiers and substantially the same role
 * structure. This keeps chat/feed replays meaningful without weakening the
 * stricter source-screen guard or treating a shared app root as a match.
 */
function replayDestinationMatches(
  observed: AuthoringObservation,
  expected: readonly ScreenIdentityObservation[],
): boolean {
  const semantic = semanticObservation(observed);
  if (!semantic || expected.length === 0) return false;
  return expected.some((candidate) => {
    const comparison = compareScreenIdentity(semantic, candidate);
    if (comparison.decision === "match") return true;
    if (comparison.decision !== "possible") return false;

    const expectedIdentifiers = new Set(
      candidate.nodes.flatMap((node) => (node.identifier ? [node.identifier] : [])),
    );
    const observedIdentifiers = new Set(
      semantic.nodes.flatMap((node) => (node.identifier ? [node.identifier] : [])),
    );
    const sharedIdentifiers = [...expectedIdentifiers].filter((identifier) =>
      observedIdentifiers.has(identifier),
    );
    const identifierSignal = comparison.signals.find(
      (signal) => signal.kind === "stable-identifier-overlap",
    );
    const roleLabelSignal = comparison.signals.find(
      (signal) => signal.kind === "role-label-overlap",
    );
    const structuralSignal = comparison.signals.find(
      (signal) => signal.kind === "structural-overlap",
    );
    const expectedInteractiveLabels = new Set(
      candidate.nodes.flatMap((node) =>
        node.label && (node.hittable || /button|imageview/u.test(node.role))
          ? [`${node.role}\u0000${node.label}`]
          : [],
      ),
    );
    const observedInteractiveLabels = new Set(
      semantic.nodes.flatMap((node) =>
        node.label && (node.hittable || /button|imageview/u.test(node.role))
          ? [`${node.role}\u0000${node.label}`]
          : [],
      ),
    );
    const sharedInteractiveLabels = [...expectedInteractiveLabels].filter((label) =>
      observedInteractiveLabels.has(label),
    );
    return (
      sharedIdentifiers.length >= 2 &&
      sharedInteractiveLabels.length >= 2 &&
      sharedInteractiveLabels.length / expectedInteractiveLabels.size >= 0.5 &&
      (identifierSignal?.strength ?? 0) >= 0.8 &&
      (roleLabelSignal?.strength ?? 0) >= 0.2 &&
      (structuralSignal?.strength ?? 0) >= 0.6
    );
  });
}

export function observationMatchesExpectedDestination(
  observed: AuthoringObservation,
  expected: { fingerprints: string[]; observations: ScreenIdentityObservation[] },
): boolean {
  const hasExpectedDestination =
    expected.fingerprints.length > 0 || expected.observations.length > 0;
  if (!hasExpectedDestination) return true;
  return (
    expected.fingerprints.includes(observed.screen.fingerprint) ||
    replayDestinationMatches(observed, expected.observations)
  );
}

export function destinationMismatchError(
  expected: { fingerprints: string[]; title?: string },
  received: AuthoringObservation,
  activity: "Recording" | "Replay",
): string {
  const chrome = received.nodes ? describeSnapshotChrome(received.nodes) : {};
  const expectedName = expected.title ?? "the expected screen";
  const receivedName = chrome.header ?? chrome.app ?? "a different screen";
  return `${activity} landed on “${receivedName}”, not “${expectedName}”`;
}

/** The live demonstration is the first successful pass. A second device run is
 * only required after the Take is edited, or when the recorded destination
 * does not match the expected screen. */
export async function attachLiveDemonstrationAttempt(
  session: AuthoringSession,
): Promise<AuthoringSession> {
  const take = session.take;
  if (!take) return session;
  const revision = currentRevision(session);
  if (!revision.before || !revision.after) return session;
  const latest = take.replayAttempts.at(-1);
  if (latest?.takeRevision === revision.revision) return session;
  const expected = await expectedReplayScreen(session, revision);
  const destination = await destinationForSession(session);
  const stayed = recordingStayedOnSourceError(session, revision, destination);
  const matches = !stayed && observationMatchesExpectedDestination(revision.after, expected);
  const attempt: AuthoringReplayAttempt = {
    id: `replay-${randomUUID()}`,
    takeId: take.id,
    takeRevision: revision.revision,
    startedAt: revision.before.capturedAt,
    finishedAt: Math.max(revision.after.capturedAt, now()),
    outcome: matches ? "passed" : "failed",
    evidence: [],
    ...(matches
      ? {}
      : {
          error: stayed ?? destinationMismatchError(expected, revision.after, "Recording"),
        }),
  };
  return {
    ...session,
    take: {
      ...take,
      replayAttempts: [...take.replayAttempts, attempt],
    },
  };
}

function recordingStayedOnSourceError(
  session: AuthoringSession,
  revision: AuthoringTakeRevision,
  destination: AuthoringCommitDestination | undefined,
): string | undefined {
  if (!revision.before || !revision.after) return undefined;
  if (!revision.actions.some((action) => action.steps.length > 0)) return undefined;
  if (revision.after.screen.fingerprint !== revision.before.screen.fingerprint) return undefined;
  const destScreenId = destination?.kind === "screen" ? destination.screenId : undefined;
  const targetsAnotherScreen =
    destination?.kind === "new-screen" ||
    (Boolean(destScreenId) && destScreenId !== session.sourceScreenId);
  if (!targetsAnotherScreen) return undefined;
  return "Recording did not leave the source screen. If the picture changed, the app likely opened Settings or another process — XCTest is still attached here. Launch that app before trusting this tree.";
}

export async function destinationForSession(
  session: AuthoringSession,
  override?: AuthoringCommitDestination,
): Promise<AuthoringCommitDestination | undefined> {
  if (override) return override;
  if (session.destination) return session.destination;
  if (!session.pendingConnectionId) return undefined;
  const appMap = await readAppMap(session.projectId, session.appMapId);
  return appMap?.connections[session.pendingConnectionId]?.destination;
}

export async function approvedAfterObservation(
  session: AuthoringSession,
  revision: AuthoringTakeRevision,
  destination?: AuthoringCommitDestination,
): Promise<AuthoringObservation | undefined> {
  const stayed = recordingStayedOnSourceError(session, revision, destination);
  if (stayed) throw new AuthoringStateError(stayed);
  const take = session.take!;
  const latestAttempt = take.replayAttempts.at(-1);
  if (latestAttempt?.takeRevision === revision.revision) {
    if (latestAttempt.outcome === "passed") {
      return latestAttempt.after ?? revision.after;
    }
    throw new AuthoringStateError(
      latestAttempt.error ?? "Replay the current Take successfully before committing it",
    );
  }
  if (revision.reason === "recording" && revision.before && revision.after) {
    const expected = await expectedReplayScreen(session, revision);
    if (observationMatchesExpectedDestination(revision.after, expected)) {
      return revision.after;
    }
    throw new AuthoringStateError(destinationMismatchError(expected, revision.after, "Recording"));
  }
  throw new AuthoringStateError("Replay the current Take successfully before committing it");
}

export async function assertExpectedSource(
  session: AuthoringSession,
  observed: AuthoringObservation,
  fallback?: AuthoringObservation,
  activity: "recording" | "replaying" = "recording",
): Promise<void> {
  const expected = await expectedSourceScreen(session);
  const fingerprints = expected?.fingerprints.length
    ? expected.fingerprints
    : fallback?.screen.fingerprint
      ? [fallback.screen.fingerprint]
      : [];
  const expectedSemantics = expected?.observations.length
    ? expected.observations
    : semanticObservation(fallback)
      ? [semanticObservation(fallback)!]
      : [];
  if (
    (fingerprints.length === 0 && expectedSemantics.length === 0) ||
    fingerprints.includes(observed.screen.fingerprint) ||
    semanticsMatch(observed, expectedSemantics) ||
    replayDestinationMatches(observed, expectedSemantics)
  )
    return;
  throw new AuthoringStateError(
    expected
      ? `Navigate the device to “${expected.title}” before ${activity} this connection`
      : "Return the device to the recorded source screen before replaying this connection",
  );
}

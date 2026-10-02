import { compileBrowserEnvironment, type AuthoringSession } from "@relay/protocol";
import { browserCaseProfileForTarget } from "./browser-case-profile-target.js";
import { closeBrowserTarget, getBrowserDevice } from "./browser-target.js";
import { readTarget } from "./targets.js";

/** Each replay starts from immutable account state, not cookies changed while
 * recording. Keep the live authoring browser intact for review and recovery. */
export async function prepareAuthoringBrowserReplay(session: AuthoringSession) {
  if (session.target.kind !== "browser") throw new Error("A browser recording is required");
  const target = await readTarget(session.target.targetId);
  if (!target?.browser) throw new Error("The recorded browser is no longer available");
  const { authenticationFixtureId: _savedAccount, ...environment } =
    browserCaseProfileForTarget(target);
  const fixtureId = session.target.authenticationFixtureId?.trim();
  await closeBrowserTarget(target.id, {
    mode: "proof",
    ...(fixtureId ? { authenticationFixtureId: fixtureId } : {}),
  });
  return getBrowserDevice(target.id, {
    mode: "proof",
    headless: true,
    recordVideo: false,
    projectId: session.projectId,
    profile: compileBrowserEnvironment({
      ...environment,
      ...(fixtureId ? { authenticationFixtureId: fixtureId } : {}),
    }),
  });
}

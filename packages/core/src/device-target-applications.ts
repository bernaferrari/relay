import { readWorkspaceSetting, writeWorkspaceSetting } from "./workspace-settings.js";
import { currentTargetContext, targetIdentity } from "./target-context.js";

const applicationsByTarget = new Map<string, string>();
const TARGET_APPLICATIONS_FILE = "runtime/target-applications.json";
let applicationsLoaded = false;
let applicationsWrite = Promise.resolve();

export function targetKey(context = currentTargetContext()): string {
  return `${context.platform}:${targetIdentity(context)}`;
}

async function loadTargetApplications(): Promise<void> {
  if (applicationsLoaded) return;
  const stored = await readWorkspaceSetting(TARGET_APPLICATIONS_FILE).catch(() => null);
  if (stored && typeof stored === "object" && !Array.isArray(stored)) {
    const values = (stored as { applications?: unknown }).applications;
    if (values && typeof values === "object" && !Array.isArray(values)) {
      for (const [key, app] of Object.entries(values)) {
        if (typeof app === "string" && app.trim()) applicationsByTarget.set(key, app.trim());
      }
    }
  }
  applicationsLoaded = true;
}

async function persistTargetApplications(): Promise<void> {
  const applications = Object.fromEntries(
    [...applicationsByTarget.entries()].sort(([left], [right]) => left.localeCompare(right)),
  );
  applicationsWrite = applicationsWrite
    .catch(() => undefined)
    .then(() => writeWorkspaceSetting(TARGET_APPLICATIONS_FILE, { version: 1, applications }));
  await applicationsWrite;
}

/** Last app Relay intentionally opened on a target; used to repair XCTest binding drift. */
export async function rememberedTargetApplication(
  context = currentTargetContext(),
): Promise<string | undefined> {
  await loadTargetApplications();
  return applicationsByTarget.get(targetKey(context));
}

export async function rememberTargetApplication(
  app: string | undefined,
  context = currentTargetContext(),
): Promise<void> {
  await loadTargetApplications();
  const value = app?.trim();
  if (value) applicationsByTarget.set(targetKey(context), value);
  else applicationsByTarget.delete(targetKey(context));
  await persistTargetApplications();
}

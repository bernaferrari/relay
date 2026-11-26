/**
 * Operator desktop packaging is not iPhone/iPad XCTest signing.
 * Apple Development identities can run a local runner. They cannot ship a
 * notarized Relay .dmg. Fail closed unless Developer ID Application is present.
 */

export type OperatorDesktopPackaging = {
  status: "ready" | "needs-attention";
  detail: string;
  identityName?: string;
};

export type DeveloperIdApplicationIdentity = {
  name: string;
  teamId: string;
};

const DEVELOPER_ID_APPLICATION =
  /"((?:Developer ID Application):[^"\n]+?)\s*\(([A-Z0-9]{6,32})\)"/g;

const MISSING_DEVELOPER_ID =
  "A Developer ID Application identity is required to ship a signed operator build. Apple Development is not enough. Morning review stays on the Vite UI and local server until that identity exists.";

/** Parse Developer ID Application identities from `security find-identity` output. */
export function findDeveloperIdApplicationIdentities(
  output: string | null,
): DeveloperIdApplicationIdentity[] {
  if (!output) return [];
  const identities: DeveloperIdApplicationIdentity[] = [];
  const seen = new Set<string>();
  for (const match of output.matchAll(DEVELOPER_ID_APPLICATION)) {
    const name = match[1]?.trim();
    const teamId = match[2]?.trim();
    if (!name || !teamId || seen.has(teamId)) continue;
    seen.add(teamId);
    identities.push({ name, teamId });
  }
  return identities;
}

/** Settings status for a signed operator build. Never treats Apple Development as ready. */
export function inspectOperatorDesktopPackaging(
  identitiesOutput: string | null,
): OperatorDesktopPackaging {
  const found = findDeveloperIdApplicationIdentities(identitiesOutput)[0];
  if (!found) {
    return { status: "needs-attention", detail: MISSING_DEVELOPER_ID };
  }
  return {
    status: "ready",
    detail: `${found.name} can sign a Relay operator build.`,
    identityName: found.name,
  };
}

/** Dist/package preflight. Throws instead of falling back to Apple Development or ad-hoc. */
export function requireDeveloperIdApplicationIdentity(identitiesOutput: string | null): string {
  const found = findDeveloperIdApplicationIdentities(identitiesOutput)[0];
  if (!found) {
    throw new Error(MISSING_DEVELOPER_ID);
  }
  return found.name;
}

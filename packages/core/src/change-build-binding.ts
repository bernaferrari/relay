import {
  changeVerificationBuildSchema,
  type Build,
  type ChangeVerificationBuild,
} from "@relay/protocol";
import {
  preflightRegisteredBuild,
  type BuildCommandRunner,
  type RegisteredBuildPreflight,
} from "./builds.js";
import { artifactDigestForProof, artifactSourceSha256 } from "./artifact-digest.js";
import type { TargetContext } from "./target-context.js";

const EXACT_GIT_SHA = /^[a-f0-9]{40}$/u;
const HEX_SHA256 = /^[a-f0-9]{64}$/u;

function requiredProvenance(value: string | undefined, name: string): string {
  const normalized = value?.trim();
  if (!normalized) throw new Error(`Proof build binding requires ${name}`);
  return normalized;
}

export { artifactDigestForProof } from "./artifact-digest.js";

export type BindRegisteredBuildToProofInput = {
  build: Build;
  changeHeadSha: string;
  target?: TargetContext;
  run?: BuildCommandRunner;
  preflight?: RegisteredBuildPreflight;
};

/** Turn an installable registered mobile build into the small, immutable
 * identity stored by a Proof. Manual/legacy builds remain installable, but
 * they cannot be used as merge evidence until provenance is complete. */
export async function bindRegisteredBuildToProof(
  input: BindRegisteredBuildToProofInput,
): Promise<ChangeVerificationBuild> {
  if (!EXACT_GIT_SHA.test(input.changeHeadSha)) {
    throw new Error("changeHeadSha must be an exact lowercase 40-character Git SHA");
  }
  if (input.build.status !== "ready") throw new Error("Proof build must be ready");
  const sourceSha = requiredProvenance(input.build.sourceSha, "sourceSha");
  if (sourceSha !== input.changeHeadSha) {
    throw new Error("Build sourceSha does not match the exact Proof headSha");
  }
  const configuration = requiredProvenance(input.build.configuration, "configuration");
  const environmentRevision = requiredProvenance(
    input.build.environmentRevision,
    "environmentRevision",
  );
  const preflight =
    input.preflight ??
    (await preflightRegisteredBuild(input.build, { target: input.target, run: input.run }));
  if (!preflight.ok || !preflight.artifact) {
    const failures = preflight.checks
      .filter(({ status }) => status === "fail")
      .map(({ message }) => message)
      .join("; ");
    throw new Error(failures || "Build preflight did not produce an installable artifact");
  }
  if (
    input.build.applicationId &&
    preflight.applicationId &&
    input.build.applicationId !== preflight.applicationId
  ) {
    throw new Error("Build applicationId does not match the observed artifact identity");
  }
  const artifactDigest = await artifactDigestForProof(preflight.artifact.path);
  const expectedDigest = input.build.sourceSha256?.trim().toLowerCase();
  if (
    expectedDigest &&
    (!HEX_SHA256.test(expectedDigest) ||
      (await artifactSourceSha256(preflight.artifact.path)) !== expectedDigest)
  ) {
    throw new Error("Build artifact digest does not match registered sourceSha256");
  }
  return changeVerificationBuildSchema.parse({
    id: input.build.id,
    platform: input.build.platform,
    artifactDigest,
    sourceSha,
    configuration,
    environmentRevision,
  });
}

export type VerifiedWebDeployment = {
  id: string;
  url: string;
  sourceSha: string;
  deploymentDigest: `sha256:${string}`;
  configuration: string;
  environmentRevision: string;
};

/** Bind provider-observed web deployment provenance. This does not infer a
 * digest from a URL: the deployment system must report an exact immutable
 * digest, otherwise the build is insufficient evidence. */
export function bindVerifiedWebDeploymentToProof(input: {
  deployment: VerifiedWebDeployment;
  changeHeadSha: string;
}): ChangeVerificationBuild {
  const url = new URL(input.deployment.url);
  const local =
    url.protocol === "http:" &&
    (url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]");
  if (url.protocol !== "https:" && !local) {
    throw new Error("Web Proof deployment must use https or a loopback development URL");
  }
  if (input.deployment.sourceSha !== input.changeHeadSha) {
    throw new Error("Web deployment sourceSha does not match the exact Proof headSha");
  }
  return changeVerificationBuildSchema.parse({
    id: input.deployment.id,
    platform: "web",
    artifactDigest: input.deployment.deploymentDigest,
    sourceSha: input.deployment.sourceSha,
    configuration: input.deployment.configuration,
    environmentRevision: input.deployment.environmentRevision,
  });
}

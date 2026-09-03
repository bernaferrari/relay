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
import { assertWebBuildProviderReceipt } from "./web-build-verification.js";

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
  /** Compatibility alias. New callers should bind against changeTestedSha. */
  changeHeadSha?: string;
  changeTestedSha?: string;
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
  if (input.build.platform === "web") {
    throw new Error(
      "Web Proof builds require a provider-verified deployment; use bindRegisteredWebDeploymentToProof",
    );
  }
  const expectedSha = input.changeTestedSha ?? input.changeHeadSha;
  if (!expectedSha || !EXACT_GIT_SHA.test(expectedSha)) {
    throw new Error(
      "changeTestedSha (legacy changeHeadSha) must be an exact lowercase 40-character Git SHA",
    );
  }
  if (input.build.status !== "ready") throw new Error("Proof build must be ready");
  const sourceSha = requiredProvenance(input.build.sourceSha, "sourceSha");
  if (sourceSha !== expectedSha) {
    throw new Error("Build sourceSha does not match the exact Proof testedSha (legacy headSha)");
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

export type VerifiedWebBuild = Omit<ChangeVerificationBuild, "platform" | "artifactDigest"> & {
  platform: "web";
  artifactDigest: `sha256:${string}`;
};

/** Convert a registered web build into the provider-verified deployment
 * contract used by Proof preparation and execution. Web entries deliberately
 * have no local artifact path: their immutable deployment digest, exact
 * source SHA, URL, configuration, and environment revision are the complete
 * server-owned identity. */
export function bindRegisteredWebDeploymentToProof(input: {
  build: Build;
  /** Compatibility alias. New callers should bind against changeTestedSha. */
  changeHeadSha?: string;
  changeTestedSha?: string;
}): VerifiedWebBuild {
  if (input.build.platform !== "web") {
    throw new Error("Registered web Proof binding requires a web build");
  }
  if (input.build.webDeploymentMode === "self-managed") {
    throw new Error(
      "Self-managed web development cannot be used as provider-verified Proof evidence",
    );
  }
  if (input.build.status !== "ready") throw new Error("Provider web Proof build must be ready");
  assertWebBuildProviderReceipt(input.build.webProviderReceipt, input.build);
  if (input.build.webProviderReceipt.deploymentId !== input.build.id) {
    throw new Error("Web build id does not match the signed provider deployment id");
  }
  const url = requiredProvenance(input.build.sourceUrl, "web deployment URL");
  const deploymentDigest = requiredProvenance(input.build.deploymentDigest, "deploymentDigest");
  const sourceSha = requiredProvenance(input.build.sourceSha, "sourceSha");
  const configuration = requiredProvenance(input.build.configuration, "configuration");
  const environmentRevision = requiredProvenance(
    input.build.environmentRevision,
    "environmentRevision",
  );
  return bindVerifiedWebDeploymentToProof({
    deployment: {
      id: input.build.id,
      url,
      sourceSha,
      deploymentDigest: deploymentDigest as `sha256:${string}`,
      configuration,
      environmentRevision,
    },
    ...(input.changeTestedSha ? { changeTestedSha: input.changeTestedSha } : {}),
    ...(input.changeHeadSha ? { changeHeadSha: input.changeHeadSha } : {}),
  }) as VerifiedWebBuild;
}

/** Bind provider-observed web deployment provenance. This does not infer a
 * digest from a URL: the deployment system must report an exact immutable
 * digest, otherwise the build is insufficient evidence. */
export function bindVerifiedWebDeploymentToProof(input: {
  deployment: VerifiedWebDeployment;
  /** Compatibility alias. New callers should bind against changeTestedSha. */
  changeHeadSha?: string;
  changeTestedSha?: string;
}): VerifiedWebBuild {
  const expectedSha = input.changeTestedSha ?? input.changeHeadSha;
  if (!expectedSha || !EXACT_GIT_SHA.test(expectedSha)) {
    throw new Error(
      "changeTestedSha (legacy changeHeadSha) must be an exact lowercase 40-character Git SHA",
    );
  }
  const url = new URL(input.deployment.url);
  const local =
    url.protocol === "http:" &&
    (url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]");
  if (url.protocol !== "https:" && !local) {
    throw new Error("Web Proof deployment must use https or a loopback development URL");
  }
  if (!expectedSha || input.deployment.sourceSha !== expectedSha) {
    throw new Error(
      "Web deployment sourceSha does not match the exact Proof testedSha (legacy headSha)",
    );
  }
  return changeVerificationBuildSchema.parse({
    id: input.deployment.id,
    platform: "web",
    artifactDigest: input.deployment.deploymentDigest,
    sourceSha: input.deployment.sourceSha,
    configuration: input.deployment.configuration,
    environmentRevision: input.deployment.environmentRevision,
  }) as VerifiedWebBuild;
}

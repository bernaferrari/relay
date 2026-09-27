import type {
  ProductChange,
  ProductChangeDetails,
  ProductChangeState,
} from "@relay/product/change-journey";
import type {
  ChangeNameIndex,
  ChangeProductService,
  ProductChangeDetail,
} from "../data/change-product-service";
const names: ChangeNameIndex = {
  apps: { settings: "Settings" },
  tests: { "settings:arabic-layout": "Arabic settings layout" },
};

function productChange(status: ProductChange["status"]): ProductChange {
  return {
    id: "change-proof-private-id",
    version: status === "proved" ? 5 : status === "ready" ? 3 : 2,
    status,
    repository: "acme/settings",
    title: "Keep Arabic settings readable",
    pullRequest: 184,
    targetBranch: "main",
    agentClaim: {
      summary: "Keep Arabic settings readable",
      acceptanceCriteria: ["Compact Arabic layouts do not overlap"],
    },
    baseRevision: "a".repeat(40),
    requestedRevision: "b".repeat(40),
    ...(status === "proved" ? { decision: "proved" as const } : {}),
    runs: status === "proved" ? ["run-1"] : [],
    evidenceCount: status === "proved" ? 4 : 0,
    coverageGaps: [],
    residualRisk: [],
    affectedTestCount: 1,
    requiredVerificationCount: 1,
    advisoryVerificationCount: 0,
    updatedAt: 1788390000000,
  };
}

function productDetails(status: ProductChange["status"]): ProductChangeDetails {
  const change = productChange(status);
  return {
    change,
    history: [],
    publications:
      status === "proved"
        ? [
            {
              id: "publication-private-id",
              status: "published",
              provider: "github",
              canRetry: false,
            },
          ]
        : [],
    affectedTests: [
      {
        appId: "settings",
        testId: "arabic-layout",
        reason: "The changed layout is verified by this Test.",
        confidence: "definite",
        revision: 4,
      },
    ],
    verificationPlan: [
      {
        id: "verification-cell-private-id",
        appId: "settings",
        testId: "arabic-layout",
        targetName: "Pixel 9",
        platform: "android",
        buildName: "proof release",
        requirement: "required",
        reason: "The smallest representative Android layout.",
        dimensions: { locale: "ar" },
        estimatedDurationMs: 1_500,
        cleanupRequired: false,
        pilot: true,
      },
    ],
    nextVerification:
      status === "planning"
        ? { kind: "approve-plan", reason: "Review the selected Test and target." }
        : status === "ready"
          ? { kind: "run-pilot", reason: "Run the reviewed pilot." }
          : { kind: "none", reason: "Verification is complete." },
    planApproved: status !== "planning",
    audit: {
      policy: "relay.verify-change@2",
      policyId: "relay.verify-change",
      policyVersion: 2,
      planDigest: `sha256:${"c".repeat(64)}`,
      requestedBy: "agent:builder",
      updatedBy: "human:reviewer",
      buildIds: ["build-private-id"],
      proofVersion: change.version,
    },
    ...(status === "running-pilot"
      ? {
          execution: {
            id: "execution-private-id",
            status: "running",
            completed: 0,
            total: 1,
            nextAction: "run-pilot",
          },
        }
      : {}),
  };
}

function state(status: ProductChange["status"]): ProductChangeDetail {
  const details = productDetails(status);
  const productStatus =
    status === "running-pilot" ? "running" : status === "proved" ? "completed" : "ready";
  const canonical: ProductChangeState = {
    status: productStatus,
    change: details.change,
    details,
    ...(status === "proved"
      ? {
          report: {
            id: details.change.id,
            changeId: details.change.id,
            status,
            decision: "proved",
            runIds: ["run-1"],
            evidenceCount: 4,
            publicationCount: 1,
            summary: "Change proved with 4 evidence items.",
          },
        }
      : {}),
  };
  return { state: canonical, names };
}

const detail = state("planning");
export const fixtureChangeService: ChangeProductService = {
  list: async () => [detail.state.change!],
  open: async () => detail,
  prepare: async () => detail,
  approve: async () => state("ready"),
  run: async () => state("running-pilot"),
  watch: async () => detail,
  cancel: async () => detail,
  rerunAffected: async () => detail,
  resumeHumanEvidence: async () => detail,
  retryPublication: async () => detail,
};

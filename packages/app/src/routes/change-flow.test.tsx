/** @jsxImportSource react */
import type {
  ProductChange,
  ProductChangeDetails,
  ProductChangeState,
} from "@relay/product/change-journey";
import { createMemoryHistory } from "@tanstack/react-router";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RelayApp } from "../app";
import * as queryClientModule from "../data/query-client";
import type {
  ChangeNameIndex,
  ChangeProductService,
  ProductChangeDetail,
} from "../data/change-product-service";
import type { RecordingProductService } from "../data/recording-product-service";
import type { Platform } from "../platform/types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];

afterEach(async () => {
  await act(async () => {
    for (const root of roots.splice(0)) root.unmount();
  });
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

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
    updatedAt: Date.now(),
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
        reason: "The changed layout is verified by this test.",
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
        ? { kind: "approve-plan", reason: "Review the selected test and target." }
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

function fakeChangeService(initial: ProductChange["status"] = "planning") {
  let current = state(initial);
  const calls: string[] = [];
  const service: ChangeProductService = {
    async list() {
      calls.push("list");
      return [current.state.change!];
    },
    async open(changeId) {
      calls.push(`open:${changeId}`);
      return current;
    },
    async prepare() {
      calls.push("prepare");
      current = state("planning");
      return current;
    },
    async approve(changeId, version) {
      calls.push(`approve:${changeId}:${version}`);
      current = state("ready");
      return current;
    },
    async run(changeId, version) {
      calls.push(`run:${changeId}:${version}`);
      current = state("running-pilot");
      return current;
    },
    async watch(input) {
      calls.push("watch");
      current = state("proved");
      input.onState?.(current);
      return current;
    },
    async cancel() {
      calls.push("cancel");
      current = state("cancelled");
      return current;
    },
    async rerunAffected() {
      calls.push("rerun");
      current = state("planning");
      return current;
    },
    async resumeHumanEvidence(input) {
      calls.push(`resume-human:${input.observation}`);
      current = state("running-pilot");
      return current;
    },
    async retryPublication() {
      calls.push("retry-publication");
      return current;
    },
  };
  return { service, calls };
}

const platform: Platform = {
  platform: "web",
  getServerUrl: () => "http://127.0.0.1:8787",
  storage: { get: () => null, set: () => undefined, remove: () => undefined },
};

async function renderChange(path: string, changeService: ChangeProductService) {
  const history = createMemoryHistory({ initialEntries: [path] });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () => {
    root.render(
      <RelayApp
        platform={platform}
        history={history}
        productService={{} as RecordingProductService}
        changeService={changeService}
      />,
    );
  });
  await settle();
  return history;
}

async function settle() {
  for (let index = 0; index < 6; index++) {
    await act(async () => void (await new Promise((resolve) => setTimeout(resolve, 0))));
  }
}

function button(label: string) {
  const result = [...document.querySelectorAll("button")].find(
    (candidate) => candidate.textContent?.trim() === label,
  );
  if (!(result instanceof HTMLButtonElement)) throw new Error(`Button not found: ${label}`);
  return result;
}

async function click(element: HTMLElement) {
  await act(async () => element.click());
  await settle();
}

async function fillTextarea(value: string) {
  const textarea = document.querySelector<HTMLTextAreaElement>("#change-human-observation");
  if (!textarea) throw new Error("Human evidence textarea not found");
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(
      textarea,
      value,
    );
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await settle();
}

describe("Change verification", () => {
  it("keeps a filtered-empty change view compact and offers a direct reset", async () => {
    const fake = fakeChangeService();
    const history = await renderChange("/changes?status=active", fake.service);

    const empty = document.querySelector('[data-slot="empty-filtered"]');
    expect(empty).not.toBeNull();
    expect(empty?.textContent).toContain("No changes in progress");
    expect(empty?.textContent).toContain("There is nothing in this view right now.");

    await click(button("View all changes"));
    expect(history.location.search).toBe("?status=history");
    expect(document.body.textContent).toContain("Keep Arabic settings readable");
  });

  it("preserves loaded changes during a failed refresh and recovers in place", async () => {
    const client = queryClientModule.createRelayQueryClient();
    vi.spyOn(queryClientModule, "createRelayQueryClient").mockReturnValue(client);
    const fake = fakeChangeService();
    await renderChange("/changes", fake.service);
    const list = fake.service.list;
    fake.service.list = async () => {
      throw new TypeError("Failed to fetch");
    };
    await act(async () => {
      await client.refetchQueries({ queryKey: ["changes"] });
    });
    await settle();
    expect(document.body.textContent).toContain("Keep Arabic settings readable");
    expect(document.body.textContent).toContain("Couldn’t refresh changes");
    expect(document.querySelector('[data-slot="recovery-centered"]')).toBeNull();
    fake.service.list = list;
    await click(button("Refresh"));
    expect(document.body.textContent).not.toContain("Couldn’t refresh changes");
    expect(document.body.textContent).toContain("Keep Arabic settings readable");
  });

  it("keeps a disconnected service error compact and actionable", async () => {
    const fake = fakeChangeService();
    const service: ChangeProductService = {
      ...fake.service,
      async list() {
        throw new TypeError("Failed to fetch");
      },
    };
    await renderChange("/changes", service);
    await act(async () => void (await new Promise((resolve) => setTimeout(resolve, 1_100))));
    await settle();

    const recovery = document.querySelector('[data-slot="recovery-centered"]');
    expect(recovery).not.toBeNull();
    expect(recovery?.getAttribute("role")).toBe("alert");
    expect(recovery?.textContent).toContain("Relay is not connected");
    expect(recovery?.textContent?.match(/Your work on this screen is safe/gi)).toHaveLength(1);
    expect(button("Try again")).not.toBeNull();
  });

  it("prepares the current change from the index and routes to its canonical detail", async () => {
    const fake = fakeChangeService();
    const history = await renderChange("/changes", fake.service);

    expect(document.querySelector("h1")?.textContent).toBe("Changes");
    expect(document.body.textContent).toContain("Keep Arabic settings readable");
    expect(document.body.textContent).not.toContain("change-proof-private-id");
    await click(button("Check current change"));

    expect(fake.calls).toContain("prepare");
    expect(history.location.pathname).toBe("/changes/change-proof-private-id");
    expect(document.body.textContent).toContain(
      "Review the plan before Relay controls a device or browser",
    );
    expect(document.body.textContent).toContain("Arabic settings layout");
    expect(document.body.textContent).toContain("Pixel 9 · Android");
  });

  it("approves the frozen plan, starts canonical execution, and shows the terminal merge decision", async () => {
    const fake = fakeChangeService();
    await renderChange("/changes/change-proof-private-id", fake.service);

    await click(button("Approve plan"));
    expect(fake.calls).toContain("approve:change-proof-private-id:2");
    expect(document.body.textContent).toContain("The reviewed plan is ready");

    await click(button("Verify change"));
    expect(fake.calls).toContain("run:change-proof-private-id:3");
    expect(fake.calls).toContain("watch");
    expect(document.body.textContent).toContain("Ready to merge");
    expect(document.body.textContent?.match(/Ready to merge/g)).toHaveLength(1);
    expect(document.body.textContent).toContain("GitHub received this verification result");
    expect(document.body.textContent).toContain("Published");
    expect(document.body.textContent).not.toContain("Start Proof");
  });

  it("leads an unsuccessful decision with the first causal failure and justified follow-up", async () => {
    const fake = fakeChangeService("rejected");
    const original = state("rejected");
    const details: ProductChangeDetails = {
      ...original.state.details!,
      firstFailure: {
        summary: "The Arabic heading overlapped the primary action.",
        runId: "run-failed",
        testId: "arabic-layout",
      },
      delivery: {
        phase: "failed",
        original: {
          id: "change-proof-private-id",
          version: 3,
          state: "rejected",
          repository: "acme/app",
          baseSha: "a",
          headSha: "b",
          buildIds: ["build-92"],
          testIds: ["arabic-layout"],
          targetNames: ["Pixel 9"],
          runIds: ["run-failed"],
          planApproved: true,
          firstFailure: {
            runId: "run-failed",
            summary: "The Arabic heading overlapped the primary action.",
            testId: "arabic-layout",
          },
        },
        failureEvidence: {
          runId: "run-failed",
          summary: "The Arabic heading overlapped the primary action.",
          testId: "arabic-layout",
          proofId: "change-proof-private-id",
        },
        next: {
          action: "repair",
          reason: "A required test failed on the bound build. Repair, then verify a new build.",
        },
      },
      nextVerification: { kind: "review", reason: "Review the failed screenshot." },
    };
    const rejected: ProductChangeDetail = {
      ...original,
      state: { ...original.state, change: details.change, details },
    };
    fake.service.open = async () => rejected;
    await renderChange("/changes/change-proof-private-id", fake.service);

    expect(document.body.textContent).toContain("Required test failed");
    expect(document.body.textContent).toContain("Failure evidence");
    expect(document.body.textContent).toContain("build-92");
    expect(document.body.textContent).toContain("First problem");
    expect(document.body.textContent).toContain(
      "The Arabic heading overlapped the primary action.",
    );
    expect(document.querySelector('a[href="/runs/run-failed"]')).not.toBeNull();
    expect(button("Prepare selective rerun")).not.toBeNull();
  });

  it("shows the server-owned repair context without leaking it into the plan", async () => {
    const fake = fakeChangeService("rejected");
    const original = state("rejected");
    const details: ProductChangeDetails = {
      ...original.state.details!,
      repairPacket: {
        proofId: "change-proof-private-id",
        headSha: "b".repeat(40),
        runId: "run-failed",
        appMapId: "settings",
        testId: "arabic-layout",
        targetCaseId: "pixel-9-ar",
        firstCausalFailure: "The Arabic heading overlapped the primary action.",
        expected: "The heading remains inside its layout bounds.",
        observed: "The heading overlaps the action.",
        evidenceRefs: [`sha256:${"e".repeat(64)}`],
        relevantLogs: ["layout assertion failed"],
        suggestedScope: ["src/i18n/ar.json"],
        rerun: { operationId: "proof.rerun-affected", proofId: "change-proof-private-id" },
      },
    };
    fake.service.open = async () => ({
      ...original,
      state: { ...original.state, change: details.change, details },
    });
    await renderChange("/changes/change-proof-private-id", fake.service);

    const repair = document.querySelector('[data-slot="change-repair-context"]');
    expect(repair?.textContent).toContain("Smallest useful fix");
    expect(repair?.textContent).toContain("The heading remains inside its layout bounds.");
    expect(repair?.textContent).toContain("The heading overlaps the action.");
    expect(repair?.textContent).toContain("src/i18n/ar.json");
    await click(button("Relevant logs (1)"));
    expect(repair?.textContent).toContain("layout assertion failed");
    expect(document.querySelector('[data-slot="verification-plan"]')?.textContent).not.toContain(
      "src/i18n/ar.json",
    );
  });

  it("resumes exact paused human evidence and preserves a retryable observation", async () => {
    const fake = fakeChangeService("ready");
    const paused = state("ready");
    const details: ProductChangeDetails = {
      ...paused.state.details!,
      execution: {
        id: "execution-private-id",
        status: "paused-human",
        completed: 0,
        total: 1,
        nextAction: "human-intervention",
        attention: {
          kind: "human-evidence",
          reason: "Confirm the final layout on the connected device.",
          executionId: "execution-private-id",
          cellId: "verification-cell-private-id",
          stepId: "human-check-private-id",
        },
      },
    };
    const detail: ProductChangeDetail = {
      ...paused,
      state: { ...paused.state, status: "needs-attention", change: details.change, details },
    };
    fake.service.open = async () => detail;
    let attempts = 0;
    fake.service.resumeHumanEvidence = async (input) => {
      attempts += 1;
      fake.calls.push(`resume-human:${input.observation}`);
      if (attempts === 1) throw new TypeError("Failed to fetch");
      return state("running-pilot");
    };
    await renderChange("/changes/change-proof-private-id", fake.service);

    expect(document.body.textContent).toContain("Human evidence is required");
    expect(document.body.textContent).toContain("Confirm the final layout");
    const attention = document.querySelector('[data-slot="change-attention"]');
    const plan = document.querySelector('[data-slot="verification-plan"]');
    expect(
      attention && plan
        ? attention.compareDocumentPosition(plan) & Node.DOCUMENT_POSITION_FOLLOWING
        : 0,
    ).toBeTruthy();
    await fillTextarea("The heading stays clear of the action at 200% zoom.");
    await click(button("Save evidence and continue"));
    expect(document.body.textContent).toContain("Relay is not connected");
    expect(document.body.textContent).toContain("The app could not reach the local Relay service.");
    expect(document.querySelector<HTMLTextAreaElement>("#change-human-observation")?.value).toBe(
      "The heading stays clear of the action at 200% zoom.",
    );

    await click(button("Try again"));
    expect(fake.calls).toContain(
      "resume-human:The heading stays clear of the action at 200% zoom.",
    );
    expect(attempts).toBe(2);
  });

  it("keeps exact proof identity and digests in one Audit disclosure", async () => {
    const fake = fakeChangeService("proved");
    await renderChange("/changes/change-proof-private-id", fake.service);

    const audit = document.querySelector('[data-slot="change-audit"]')!;
    expect(audit.querySelector("button")?.getAttribute("aria-expanded")).toBe("false");
    await click(button("Technical details"));
    expect(audit.textContent).toContain("change-proof-private-id");
    expect(audit.textContent).toContain("sha256:");
    expect(document.querySelector('[data-slot="change-verdict"]')?.textContent).not.toContain(
      "sha256:",
    );
  });

  it("shows bounded provider delivery diagnostics only inside Audit details", async () => {
    const fake = fakeChangeService("proved");
    const proved = state("proved");
    const details = proved.state.details!;
    const richDetails: ProductChangeDetails = {
      ...details,
      publications: [
        {
          id: "publication-retry-id",
          status: "retry",
          provider: "github",
          attempts: 3,
          maxAttempts: 3,
          nextAttemptAt: 1_700_000_000_000,
          lastFailure: { kind: "provider-error", at: 1_699_999_999_000 },
          recovery: {
            requestId: "recovery-request-id",
            requestDigest: `sha256:${"a".repeat(64)}`,
            requestedBy: "human:reviewer",
            requestedAt: 1_699_999_998_000,
          },
          canRetry: true,
        },
        {
          id: "publication-published-id",
          status: "published",
          provider: "github",
          attempts: 1,
          maxAttempts: 3,
          publishedAt: 1_699_999_997_000,
          receipt: {
            sequence: 2,
            proofVersion: 5,
            checkRunId: 42,
            checkDigest: `sha256:${"b".repeat(64)}`,
            status: "completed",
            conclusion: "success",
            publishedAt: 1_699_999_997_000,
          },
          canRetry: false,
        },
      ],
    };
    fake.service.open = async () => ({
      ...proved,
      state: { ...proved.state, change: richDetails.change, details: richDetails },
    });
    await renderChange("/changes/change-proof-private-id", fake.service);

    expect(document.querySelector('[data-slot="change-publication"]')?.textContent).not.toContain(
      "Provider failure",
    );
    await click(button("Technical details"));
    const audit = document.querySelector('[data-slot="change-audit"]')!;
    expect(audit.textContent).toContain("Provider failureProvider rejected delivery");
    expect(audit.textContent).toContain("Next retry2023-11-14T22:13:20.000Z");
    expect(audit.textContent).toContain("Attempts3 of 3");
    expect(audit.textContent).toContain("Recovery requestrecovery-request-id");
    expect(audit.textContent).toContain("Recovery requested byhuman:reviewer");
    expect(audit.textContent).toContain("Check run ID42");
    expect(audit.textContent).toContain("Receipt sequence2");
    expect(audit.textContent).toContain("Receipt statuscompleted");
    expect(audit.textContent).toContain("Receipt conclusionsuccess");
    expect(audit.textContent).toContain("Receipt Proof version5");
    expect(audit.textContent).toContain(`Check digestsha256:${"b".repeat(64)}`);
    expect(audit.textContent).not.toContain("publication-private-token");
  });

  it("keeps a completed verdict compact without a redundant progress meter", async () => {
    const fake = fakeChangeService("proved");
    const proved = state("proved");
    const details: ProductChangeDetails = {
      ...proved.state.details!,
      execution: {
        id: "execution-private-id",
        status: "completed",
        completed: 2,
        total: 2,
        nextAction: "complete",
      },
    };
    fake.service.open = async () => ({
      ...proved,
      state: { ...proved.state, change: details.change, details },
    });
    await renderChange("/changes/change-proof-private-id", fake.service);

    const verdict = document.querySelector('[data-slot="change-verdict"]');
    expect(verdict?.textContent).toContain("Ready to merge");
    expect(verdict?.textContent).toContain("2 of 2 checks complete");
    expect(verdict?.textContent).not.toContain("Verdict");
    expect(verdict?.querySelector("progress")).toBeNull();
  });
});

/** @jsxImportSource react */
import type {
  ProductChange,
  ProductChangeDetails,
  ProductChangeState,
} from "@relay/product/change-journey";
import { createMemoryHistory } from "@tanstack/react-router";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { RelayV2App } from "../app";
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
      <RelayV2App
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

describe("Change verification", () => {
  it("keeps a filtered-empty Change view compact and offers a direct reset", async () => {
    const fake = fakeChangeService();
    const history = await renderChange("/changes?status=active", fake.service);

    const empty = document.querySelector(".relay-empty-state--filtered");
    expect(empty).not.toBeNull();
    expect(empty?.textContent).toContain("No Changes in progress");
    expect(empty?.textContent).toContain("There is nothing in this view right now.");

    await click(button("View all Changes"));
    expect(history.location.search).toBe("?status=history");
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

    const recovery = document.querySelector(".relay-changes-recovery");
    expect(recovery?.className).toContain("relay-recovery-state--centered");
    expect(recovery?.getAttribute("role")).toBe("alert");
    expect(recovery?.textContent).toContain("Relay is offline");
    expect(recovery?.textContent?.match(/your work is safe/gi)).toHaveLength(1);
    expect(button("Reconnect")).not.toBeNull();
  });

  it("prepares the current Change from the index and routes to its canonical detail", async () => {
    const fake = fakeChangeService();
    const history = await renderChange("/changes", fake.service);

    expect(document.body.textContent).toContain("Change verification");
    expect(document.body.textContent).toContain("Keep Arabic settings readable");
    expect(document.body.textContent).not.toContain("change-proof-private-id");
    await click(button("Verify current Change"));

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

    await click(button("Verify Change"));
    expect(fake.calls).toContain("run:change-proof-private-id:3");
    expect(fake.calls).toContain("watch");
    expect(document.body.textContent).toContain("Ready to merge");
    expect(document.body.textContent?.match(/Ready to merge/g)).toHaveLength(1);
    expect(document.body.textContent).toContain("GitHub received this verification result");
    expect(document.body.textContent).toContain("Published to GitHub");
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
      nextVerification: { kind: "review", reason: "Review the failed screenshot." },
    };
    const rejected: ProductChangeDetail = {
      ...original,
      state: { ...original.state, change: details.change, details },
    };
    fake.service.open = async () => rejected;
    await renderChange("/changes/change-proof-private-id", fake.service);

    expect(document.body.textContent).toContain("First problem");
    expect(document.body.textContent).toContain(
      "The Arabic heading overlapped the primary action.",
    );
    expect(document.querySelector('a[href="/runs/run-failed"]')).not.toBeNull();
    expect(button("Prepare selective rerun")).not.toBeNull();
  });

  it("keeps exact proof identity and digests in one Audit disclosure", async () => {
    const fake = fakeChangeService("proved");
    await renderChange("/changes/change-proof-private-id", fake.service);

    const audit = document.querySelector<HTMLDetailsElement>(".relay-change-audit")!;
    expect(audit.open).toBe(false);
    expect(audit.textContent).toContain("change-proof-private-id");
    expect(audit.textContent).toContain("sha256:");
    expect(document.querySelector(".relay-change-verdict")?.textContent).not.toContain("sha256:");
  });
});

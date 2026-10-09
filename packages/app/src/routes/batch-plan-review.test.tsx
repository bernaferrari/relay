/** @jsxImportSource react */
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CombineEvidenceAnalysisReport } from "@relay/protocol";
import { BatchFindingsPanel } from "./batch-plan-review";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, ...props }: { children: ReactNode; [key: string]: unknown }) => (
    <a {...props}>{children}</a>
  ),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const roots: Root[] = [];
afterEach(() => {
  act(() => roots.splice(0).forEach((root) => root.unmount()));
  document.body.replaceChildren();
});

function report(): CombineEvidenceAnalysisReport {
  return {
    schemaVersion: 1,
    batchId: "batch-1",
    locales: ["en"],
    analysis: {
      schemaVersion: 1,
      sessionId: "s1",
      generatedAt: 1,
      baselineLocale: "en",
      findings: [
        {
          id: "product-login",
          code: "PRODUCT_ASSERTION",
          severity: "critical",
          confidence: "high",
          canonicalKey: "job:job-login",
          screenLabel: "Login",
          locale: "en",
          baselineLocale: "en",
          testId: "login",
          detail: "expect-screen missed Login",
        },
        {
          id: "harness-home",
          code: "HARNESS_FAILURE",
          severity: "critical",
          confidence: "high",
          canonicalKey: "job:job-home",
          screenLabel: "Home",
          locale: "en",
          baselineLocale: "en",
          testId: "home",
          detail: "visual judge unavailable: OPENROUTER_API_KEY is not configured",
        },
      ],
      critical: 2,
      warnings: 0,
      affectedScreens: 2,
    },
    coverage: { frames: 2, inspectedFrames: 2 },
    cases: [],
  };
}

describe("BatchFindingsPanel flaky filter", () => {
  it("sorts flaky items last and can hide them without accepting a baseline", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    await act(async () => {
      root.render(
        <BatchFindingsPanel
          report={report()}
          notes={[]}
          onNotes={() => undefined}
          flakyTestIds={new Set(["login"])}
        />,
      );
    });
    const titles = [...host.querySelectorAll("h3")].map((item) => item.textContent);
    expect(titles).toEqual(["Home", "Login"]);
    expect(host.textContent).toContain("Flaky");
    expect(host.textContent).toContain("Hide flaky tests");
    expect(host.textContent).toContain("does not skip a run or accept a visual baseline");
    const toggle = host.querySelector<HTMLButtonElement>(
      '[role="checkbox"][aria-label="Hide flaky tests"]',
    );
    if (!toggle) throw new Error("Hide flaky tests control missing");
    await act(async () => toggle.click());
    await act(async () => void (await new Promise((resolve) => setTimeout(resolve, 0))));
    expect([...host.querySelectorAll("h3")].map((item) => item.textContent)).toEqual(["Home"]);
    expect(host.textContent).toContain("expect-screen missed Login");
    expect(host.textContent).not.toContain("approve-new-baseline");
  });

  it("does not offer a hide control when Findings lack a comparable flaky test", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    await act(async () => {
      root.render(<BatchFindingsPanel report={report()} notes={[]} onNotes={() => undefined} />);
    });
    expect(host.textContent).not.toContain("Hide flaky tests");
    expect([...host.querySelectorAll("h3")].map((item) => item.textContent)).toEqual([
      "Login",
      "Home",
    ]);
  });
});

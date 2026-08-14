import { expect, test, vi } from "vitest";
import { render } from "solid-js/web";
import type { AppMapScenarioTest, Proposal } from "@relay/protocol";
import { AppMapTestProposalReview } from "./app-map-test-proposal-review";

const scenario: AppMapScenarioTest = {
  id: "checkout",
  organizationId: "org",
  projectId: "project",
  appMapId: "map",
  kind: "scenario",
  name: "Checkout",
  intentSchemaVersion: 1,
  steps: [
    {
      id: "submit",
      kind: "instruction",
      intent: "Submit order",
      binding: { status: "unresolved", reason: "Choose a path" },
    },
  ],
  createdAt: 1,
  updatedAt: 1,
};

const proposal: Proposal = {
  id: "proposal",
  organizationId: "org",
  projectId: "project",
  appMapId: "map",
  baseRevision: 1,
  title: "Clarify checkout",
  status: "pending",
  changes: [
    {
      kind: "test.edit",
      testId: "checkout",
      edits: [
        { kind: "step.patch", stepId: "submit", patch: { intent: "Submit the reviewed order" } },
      ],
    },
  ],
  createdAt: 1,
  updatedAt: 1,
};

test("Test proposal review shows semantic before and after values before approval", () => {
  document.body.replaceChildren();
  const root = document.createElement("div");
  document.body.append(root);
  const approve = vi.fn();
  const dispose = render(
    () => (
      <AppMapTestProposalReview
        test={scenario}
        proposals={[proposal]}
        onApprove={approve}
        onReject={() => undefined}
        onClose={() => undefined}
      />
    ),
    root,
  );

  expect(root.textContent).toContain("Submit order");
  expect(root.textContent).toContain("Submit the reviewed order");
  const action = [...root.querySelectorAll<HTMLButtonElement>("button")].find((button) =>
    button.textContent?.includes("Approve changes"),
  )!;
  expect(action.getBoundingClientRect).toBeTypeOf("function");
  action.click();
  expect(approve).toHaveBeenCalledWith("proposal");

  dispose();
  document.body.replaceChildren();
});

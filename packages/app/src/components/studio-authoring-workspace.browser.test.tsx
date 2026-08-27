import { render } from "solid-js/web";
import { expect, test, vi } from "vitest";

vi.mock("./first-test-onboarding", () => ({
  FirstTestChecklist: () => null,
  useFirstTestOnboarding: (actions: { onRecord: () => void }) => ({
    visible: () => false,
    canReopen: () => false,
    reopen: () => undefined,
    checklistProps: () => ({ onRecord: actions.onRecord }),
  }),
}));
vi.mock("./first-operator-run", () => ({
  FirstOperatorRunCard: () => null,
  useFirstOperatorRun: () => ({ visible: () => false }),
}));
vi.mock("./app-map-workspace", () => ({ AppMapWorkspace: () => null }));
vi.mock("./app-map-test-workspace", () => ({
  AppMapTestWorkspace: (props: { onRecord?: () => void }) => (
    <button type="button" onClick={props.onRecord}>
      Record test
    </button>
  ),
}));

import { StudioAuthoringWorkspace } from "./studio-authoring-workspace";

test("Record test remains owned by the Test workspace", async () => {
  document.body.replaceChildren();
  const root = document.createElement("div");
  document.body.append(root);
  const changeMode = vi.fn();
  const recordTest = vi.fn();
  const dispose = render(
    () => (
      <StudioAuthoringWorkspace
        mode="test"
        navigatorOpen={false}
        onMode={changeMode}
        onOpenTargets={() => undefined}
        onOpenVariables={() => undefined}
        onOpenCombine={() => undefined}
        onOpenRun={() => undefined}
        onImportYaml={() => undefined}
        onExportYaml={() => undefined}
        onRecordTest={recordTest}
      />
    ),
    root,
  );
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));

  root.querySelector<HTMLButtonElement>("button")?.click();
  expect(recordTest).toHaveBeenCalledOnce();
  expect(changeMode).not.toHaveBeenCalled();
  expect(root.textContent).not.toContain("Record path");
  dispose();
  root.remove();
});

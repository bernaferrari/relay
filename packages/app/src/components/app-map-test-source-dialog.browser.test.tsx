import { createSignal } from "solid-js";
import { render } from "solid-js/web";
import { expect, test, vi } from "vitest";
import type { AppMap, AppMapScenarioTest } from "@relay/protocol";
import { AppMapTestSourceDialog } from "./app-map-test-source-dialog";

function scenario(updatedAt: number): AppMapScenarioTest {
  return {
    kind: "scenario",
    id: "settings",
    name: "Settings",
    appMapId: "map",
    organizationId: "local",
    projectId: "default",
    intentSchemaVersion: 1,
    steps: [],
    createdAt: 1,
    updatedAt,
  };
}

function appMap(test: AppMapScenarioTest, revision = 1): AppMap {
  return {
    id: "map",
    revision,
    routines: {},
    connections: {},
    tests: { [test.id]: test },
  } as unknown as AppMap;
}

test("Source refuses to overwrite a Test that changed while the dialog was open", async () => {
  document.body.replaceChildren();
  const root = document.createElement("div");
  document.body.append(root);
  const initial = scenario(1);
  const [testDocument, setTestDocument] = createSignal(initial);
  const [mapDocument, setMapDocument] = createSignal(appMap(initial));
  const onApply = vi.fn();
  const dispose = render(
    () => (
      <AppMapTestSourceDialog
        map={mapDocument()}
        test={testDocument()}
        onApply={onApply}
        onClose={() => undefined}
      />
    ),
    root,
  );

  const editor = root.querySelector<HTMLTextAreaElement>("#test-source-editor")!;
  editor.value = editor.value.replace("name: Settings", "name: My Settings");
  editor.dispatchEvent(new InputEvent("input", { bubbles: true }));
  const collaborator = { ...initial, name: "Collaborator Settings", updatedAt: 2 };
  setTestDocument(collaborator);
  setMapDocument(appMap(collaborator, 2));
  await Promise.resolve();

  [...root.querySelectorAll<HTMLButtonElement>("button")]
    .find((button) => button.textContent?.includes("Apply source"))!
    .click();
  await Promise.resolve();

  expect(onApply).not.toHaveBeenCalled();
  expect(root.textContent).toContain("This Test changed after Source opened");
  dispose();
  root.remove();
});

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
    name: "My App",
    revision,
    routines: {},
    connections: {},
    screens: {},
    variables: {},
    tests: { [test.id]: test },
  } as unknown as AppMap;
}

function friendlyFixture(): { map: AppMap; test: AppMapScenarioTest } {
  const test = scenario(1);
  test.steps = [
    {
      id: "open-settings",
      kind: "instruction",
      intent: "Open Settings",
      capture: true,
      binding: { status: "resolved", kind: "connections", connectionIds: ["open"] },
    },
  ];
  const map = appMap(test);
  map.name = "My App";
  const scope = { organizationId: "local", projectId: "default", appMapId: "map" };
  map.screens = {
    home: {
      ...scope,
      id: "home",
      title: "Home",
      variantIds: [],
      createdAt: 1,
      updatedAt: 1,
    },
    settings: {
      ...scope,
      id: "settings",
      title: "Settings",
      variantIds: [],
      createdAt: 1,
      updatedAt: 1,
    },
  };
  map.connections.open = {
    ...scope,
    id: "open",
    label: "Open settings",
    fromScreenId: "home",
    destination: { kind: "screen", screenId: "settings" },
    state: "ready",
    actions: [],
    createdAt: 1,
    updatedAt: 1,
  };
  return { map, test };
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
    .find((button) => /apply/iu.test(button.textContent ?? ""))!
    .click();
  await Promise.resolve();

  expect(onApply).not.toHaveBeenCalled();
  expect(root.textContent).toContain("This Test changed after Source opened");
  dispose();
  root.remove();
});

test("Source exposes friendly Intent and deterministic Bound modes", async () => {
  document.body.replaceChildren();
  const root = document.createElement("div");
  document.body.append(root);
  const fixture = friendlyFixture();
  const dispose = render(
    () => (
      <AppMapTestSourceDialog
        map={fixture.map}
        test={fixture.test}
        onApply={() => undefined}
        onClose={() => undefined}
      />
    ),
    root,
  );

  const intent = [...root.querySelectorAll<HTMLButtonElement>("button")].find(
    (button) => button.textContent === "Intent",
  )!;
  const bound = [...root.querySelectorAll<HTMLButtonElement>("button")].find(
    (button) => button.textContent === "Bound",
  )!;
  expect(intent.getAttribute("aria-pressed")).toBe("true");
  expect(root.querySelector<HTMLTextAreaElement>("#test-source-editor")!.value).toContain(
    "kind: authoring-intent",
  );
  expect(root.textContent).toContain("never executes directly");

  bound.click();
  await Promise.resolve();
  expect(bound.getAttribute("aria-pressed")).toBe("true");
  expect(root.querySelector<HTMLTextAreaElement>("#test-source-editor")!.value).toContain(
    "kind: bound-test",
  );
  expect(root.textContent).toContain("canonical Relay identities");

  dispose();
  root.remove();
});

test("Intent mode surfaces ambiguous bindings for review", () => {
  document.body.replaceChildren();
  const root = document.createElement("div");
  document.body.append(root);
  const fixture = friendlyFixture();
  fixture.map.connections.other = {
    ...fixture.map.connections.open!,
    id: "other",
  };
  const dispose = render(
    () => (
      <AppMapTestSourceDialog
        map={fixture.map}
        test={fixture.test}
        onApply={() => undefined}
        onClose={() => undefined}
      />
    ),
    root,
  );

  expect(root.textContent).toContain("Review 1 binding");
  expect(root.textContent).toContain("steps[0].path[0]");
  expect(root.textContent).toContain("is ambiguous");
  expect(root.textContent).toContain("Open settings (open)");
  expect(root.textContent).toContain("Open settings (other)");

  dispose();
  root.remove();
});

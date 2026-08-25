import { render } from "solid-js/web";
import { expect, test, vi } from "vitest";
import { AppMapVariableEditor } from "./app-map-variable-editor";

vi.mock("../context/server", () => ({
  useServer: () => ({
    selectedAppMap: () => ({
      id: "map-1",
      name: "Settings",
      revision: 1,
      organizationId: "org",
      projectId: "project",
      variables: {},
      screenVariants: {},
      connections: {},
    }),
    selectedDevice: () => undefined,
    captureUiSnapshot: vi.fn(),
  }),
}));

function mount(collapsed: boolean) {
  const root = document.createElement("div");
  document.body.append(root);
  const onOpenDevice = vi.fn();
  const onCancel = vi.fn();
  const onSaved = vi.fn();
  const dispose = render(
    () => (
      <AppMapVariableEditor
        collapsed={collapsed}
        onOpenDevice={onOpenDevice}
        onCancel={onCancel}
        onSaved={onSaved}
      />
    ),
    root,
  );
  return { root, onOpenDevice, dispose };
}

test("collapsed editor keeps a compact rail with the draft-saved affordance", () => {
  const mounted = mount(true);
  expect(mounted.root.querySelector('input[placeholder="Language"]')).toBeNull();
  expect(mounted.root.textContent).toContain("draft saved");
  const railButton = mounted.root.querySelector<HTMLButtonElement>(
    "button[aria-label='Open device panel']",
  );
  expect(railButton).toBeTruthy();
  railButton?.click();
  expect(mounted.onOpenDevice).toHaveBeenCalled();
  mounted.dispose();
});

test("expanded editor keeps the full draft form", () => {
  const mounted = mount(false);
  expect(mounted.root.querySelector("#variable-editor-title")).toBeTruthy();
  expect(mounted.root.textContent).not.toContain("draft saved");
  mounted.dispose();
});

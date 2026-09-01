import { render } from "solid-js/web";
import { expect, test, vi } from "vitest";

vi.mock("../context/server", () => ({
  useServer: () => ({
    accessibilityMode: () => "hover",
    setAccessibilityMode: () => undefined,
  }),
}));

vi.mock("./device-companion-stage", () => ({
  DeviceCompanionStage: () => null,
}));

import { AppMapDeviceCompanion } from "./app-map-device-companion";

function renderCompanion(outsideMapApp: boolean) {
  const actions = {
    save: vi.fn(),
    survey: vi.fn(),
    record: vi.fn(),
  };
  const root = document.createElement("div");
  document.body.append(root);
  const dispose = render(
    () => (
      <AppMapDeviceCompanion
        closing={false}
        deviceSelected
        deviceLabel="Pixel"
        status={{ label: "Live", kind: "ready" }}
        recording={false}
        take={null}
        unmapped={false}
        outsideMapApp={outsideMapApp}
        mappedScreenName="Settings"
        captureBusy={false}
        canRecord
        mapName="Settings"
        captureContextLabel={undefined}
        onClose={() => undefined}
        onOpenTargets={() => undefined}
        onSaveScreen={actions.save}
        onSurveyPage={actions.survey}
        onRecord={actions.record}
        onStop={() => undefined}
      />
    ),
    root,
  );
  return { root, dispose, actions };
}

test("another foreground app blocks every authoring capture and recording action", () => {
  const { root, dispose, actions } = renderCompanion(true);

  expect(root.textContent).toContain("Another app is open");
  expect(root.textContent).not.toContain("Screenshot");
  expect(root.textContent).not.toContain("Start recording");
  const fullPage = root.querySelector<HTMLButtonElement>(
    'button[aria-label="Capture full scrollable page"]',
  );
  expect(fullPage?.disabled).toBe(true);
  fullPage?.click();
  expect(actions.survey).not.toHaveBeenCalled();
  expect(actions.save).not.toHaveBeenCalled();
  expect(actions.record).not.toHaveBeenCalled();

  dispose();
  root.remove();
});

test("the mapped app retains its ordinary screenshot and recording actions", () => {
  const { root, dispose } = renderCompanion(false);

  expect(root.textContent).toContain("Screenshot");
  expect(root.textContent).toContain("Start recording");
  expect(
    root.querySelector<HTMLButtonElement>('button[aria-label="Capture full scrollable page"]')
      ?.disabled,
  ).toBe(false);

  dispose();
  root.remove();
});

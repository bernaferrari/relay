import { render } from "solid-js/web";
import { expect, test, vi } from "vitest";
import type { LocaleMatrixMaterialization } from "@relay/protocol";

const serverMock = vi.hoisted(() => ({ current: undefined as unknown }));
vi.mock("../context/server", () => ({ useServer: () => serverMock.current }));

import { LocaleMatrixStart } from "./locale-matrix-start";

const materialization: LocaleMatrixMaterialization = {
  schemaVersion: 1,
  materializedAt: 1,
  source: { kind: "recipe", recipeId: "settings" },
  scope: { locales: ["en"], entryPath: [{ kind: "tap" }], restoreLocale: "en" },
  cases: [{ caseIndex: 0, locale: "en" }],
  durationCohort: { testId: "settings", action: "settings" },
  targetPlatform: "ios",
};

async function settle(): Promise<void> {
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await Promise.resolve();
}

test("Locale Matrix start preserves its taught profile constraint", async () => {
  document.body.replaceChildren();
  const root = document.createElement("div");
  document.body.append(root);
  const materialize = vi.fn(async () => materialization);
  const run = vi.fn(async () => ({ batchId: "locale-1", jobIds: [] }));
  serverMock.current = {
    health: () => "online",
    devices: () => [],
    localeMatrix: { materialize, run },
    estimateCampaignDurationCohorts: async () => ({ checkedAt: 1, estimates: [] }),
    preflightLocalCampaignAdmission: async () => ({}),
  };

  const dispose = render(
    () => (
      <LocaleMatrixStart recipeId="settings" locales={["en"]} profileId="grok-ios" preset="grok" />
    ),
    root,
  );
  try {
    await settle();
    expect(materialize).toHaveBeenCalledWith(
      expect.objectContaining({ profileId: "grok-ios", preset: "grok" }),
    );

    const start = [...root.querySelectorAll<HTMLButtonElement>("button")].find((button) =>
      button.textContent?.includes("Run on selected device"),
    );
    if (!start) throw new Error("expected selected-device start control");
    start.click();
    await settle();

    expect(run).toHaveBeenCalledWith(
      "settings",
      ["en"],
      expect.objectContaining({
        profileId: "grok-ios",
        preset: "grok",
        scope: materialization.scope,
      }),
    );
  } finally {
    dispose();
    root.remove();
  }
});

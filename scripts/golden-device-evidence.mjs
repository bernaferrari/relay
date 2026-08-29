import { errorRecord, fail, isRecord } from "./golden-device-contract.mjs";

/**
 * Capture one coherent fixture observation. iOS accessibility and pixels use
 * independent transports, so its evidence is deliberately bracketed instead
 * of racing readings that may describe different screens.
 */
export async function captureGoldenFixtureEvidence(api, writer, fixture, phase) {
  const encoded = encodeURIComponent(fixture.serial);
  const directory = `fixtures/${fixture.platform}/${phase}`;
  const captureSnapshot = () =>
    api.request({
      operationId: "target.snapshot.capture",
      path: `/snapshot?serial=${encoded}&visual=true`,
    });
  const captureScreenshot = () =>
    api.request({
      operationId: "target.screenshot.capture",
      path: `/screenshot?serial=${encoded}&ephemeral=1`,
    });

  if (fixture.platform === "ios") {
    const before = await captureScreenshot();
    await writer.screenshot(`${directory}/before.png`, before);
    const snapshot = await captureSnapshot();
    assertGoldenSemanticSnapshot(snapshot, fixture);
    await writer.json(`${directory}/tree.json`, snapshot);
    const after = await captureScreenshot();
    await writer.screenshot(`${directory}/after.png`, after);
    return { snapshot, screenshot: after };
  }

  const [snapshot, screenshot] = await Promise.all([captureSnapshot(), captureScreenshot()]);
  assertGoldenSemanticSnapshot(snapshot, fixture);
  await writer.json(`${directory}/tree.json`, snapshot);
  await writer.screenshot(`${directory}/screen.png`, screenshot);
  return { snapshot, screenshot };
}

function usableSemanticNode(node) {
  if (!isRecord(node)) return false;
  const role = String(node.role ?? node.type ?? "")
    .trim()
    .toLowerCase();
  if (role === "application" || role === "window") return false;
  if (node.enabled === false || node.visibleToUser === false) return false;
  const rect = node.rect;
  if (
    !isRecord(rect) ||
    !Number.isFinite(Number(rect.width)) ||
    !Number.isFinite(Number(rect.height)) ||
    Number(rect.width) <= 0 ||
    Number(rect.height) <= 0
  ) {
    return false;
  }
  return [node.identifier, node.ref, node.label, node.value].some(
    (value) => typeof value === "string" && value.trim().length > 0,
  );
}

/** Strict golden lanes require a current, app-scoped semantic observation.
 * Pixels-only observations remain useful elsewhere, but cannot satisfy this
 * fixture's accessibility proof requirement. */
export function assertGoldenSemanticSnapshot(snapshot, fixture) {
  const platform = fixture.platform === "ios" ? "iOS" : "Android";
  if (!isRecord(snapshot) || !Array.isArray(snapshot.nodes)) {
    fail(`Golden ${platform} snapshot response was malformed`, "GOLDEN_SNAPSHOT_INVALID");
  }
  if (snapshot.inspectable !== true || !snapshot.nodes.some(usableSemanticNode)) {
    fail(
      `Golden ${platform} snapshot had no current usable semantic controls`,
      "GOLDEN_SNAPSHOT_UNUSABLE",
    );
  }
  const owners = new Set(
    snapshot.nodes
      .map((node) => (isRecord(node) && typeof node.bundleId === "string" ? node.bundleId : ""))
      .filter(Boolean),
  );
  const foregroundMatches = snapshot.foregroundApp === fixture.app || owners.has(fixture.app);
  if (!foregroundMatches) {
    fail(
      `Golden ${platform} snapshot did not prove foreground app ${fixture.app}`,
      "GOLDEN_SNAPSHOT_WRONG_APP",
    );
  }
}

function imageDimensions(screenshot, label) {
  const width = Number(screenshot?.width);
  const height = Number(screenshot?.height);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    fail(`${label} did not include usable screenshot dimensions`, "GOLDEN_ROTATION_UNPROVEN");
  }
  return { width, height };
}

/** Rotate, prove landscape pixels, and always restore and prove portrait. */
export async function runGoldenRotationScenario(api, writer, fixture) {
  const runStep = async (orientation, phase) => {
    const response = await api.request({
      operationId: "step.run",
      method: "POST",
      path: "/step/run",
      body: { serial: fixture.serial, step: { kind: "rotate", orientation } },
    });
    await writer.json(`fixtures/${fixture.platform}/rotation-${phase}.json`, response);
    if (!isRecord(response) || response.ok !== true) {
      fail(
        `${fixture.platform} rotation ${phase} did not complete successfully.`,
        "GOLDEN_ROTATION_FAILED",
      );
    }
  };

  let landscapeError;
  try {
    await captureGoldenFixtureEvidence(api, writer, fixture, "rotation-entrance");
    await runStep(fixture.rotation.orientation, "landscape");
    const landscape = await captureGoldenFixtureEvidence(
      api,
      writer,
      fixture,
      "rotation-landscape",
    );
    const dimensions = imageDimensions(landscape.screenshot, "Landscape rotation capture");
    if (dimensions.width <= dimensions.height) {
      fail(
        `${fixture.platform} rotation did not produce landscape pixels; do not accept an unverified orientation change.`,
        "GOLDEN_ROTATION_UNPROVEN",
      );
    }
  } catch (error) {
    landscapeError = error;
    await writer
      .json(`fixtures/${fixture.platform}/rotation-landscape-error.json`, errorRecord(error))
      .catch(() => undefined);
  }

  // A failed acknowledgement does not prove that the fixture stayed portrait.
  // Preserve the first failure, but always make one bounded restoration.
  let restoreError;
  try {
    await runStep(fixture.rotation.restoreOrientation, "restore");
    const portrait = await captureGoldenFixtureEvidence(api, writer, fixture, "rotation-restored");
    const dimensions = imageDimensions(portrait.screenshot, "Portrait restoration capture");
    if (dimensions.height <= dimensions.width) {
      fail(
        `${fixture.platform} rotation did not restore portrait pixels; fixture must be returned to canonical orientation.`,
        "GOLDEN_ROTATION_UNPROVEN",
      );
    }
  } catch (error) {
    restoreError = error;
    await writer
      .json(`fixtures/${fixture.platform}/rotation-restore-error.json`, errorRecord(error))
      .catch(() => undefined);
  }
  if (landscapeError) throw landscapeError;
  if (restoreError) throw restoreError;
}

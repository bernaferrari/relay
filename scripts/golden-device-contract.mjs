import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

export const GOLDEN_FIXTURE_SCHEMA_VERSION = 1;

export const REQUIRED_GOLDEN_SCENARIOS = [
  "proofReplay",
  "delayedSemanticFallback",
  "semanticInput",
  "pointInput",
  "parallelScheduling",
  // iOS trustworthiness lanes: a runner killed mid-session must reconnect
  // cleanly, a wedged developer disk image must recover without a reboot,
  // and control must survive an app → Settings handoff.
  "runnerKillMidSession",
  "ddiUnmountRecover",
  "appHandoffToSettings",
];

const LANDSCAPE_ORIENTATIONS = new Set(["landscape-left", "landscape-right"]);

export class GoldenAcceptanceError extends Error {
  constructor(message, code = "GOLDEN_ACCEPTANCE_FAILED") {
    super(message);
    this.name = "GoldenAcceptanceError";
    this.code = code;
  }
}

export function fail(message, code) {
  throw new GoldenAcceptanceError(message, code);
}

export function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function requiredString(value, name) {
  if (typeof value !== "string" || !value.trim()) {
    fail(`${name} must be a non-empty string`, "GOLDEN_FIXTURE_CONFIG_INVALID");
  }
  return value.trim();
}

function optionalString(value, name) {
  if (value === undefined) return undefined;
  return requiredString(value, name);
}

function requiredRecipeId(value, name) {
  const recipeId = requiredString(value, name);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u.test(recipeId)) {
    fail(`${name} must be a safe recipe id`, "GOLDEN_FIXTURE_CONFIG_INVALID");
  }
  return recipeId;
}

function parseRotation(value, platform) {
  if (!isRecord(value)) {
    fail(`fixtures.${platform}.rotation must be an object`, "GOLDEN_FIXTURE_CONFIG_INVALID");
  }
  const orientation = requiredString(
    value.orientation,
    `fixtures.${platform}.rotation.orientation`,
  );
  if (!LANDSCAPE_ORIENTATIONS.has(orientation)) {
    fail(
      `fixtures.${platform}.rotation.orientation must be landscape-left or landscape-right`,
      "GOLDEN_FIXTURE_CONFIG_INVALID",
    );
  }
  const restoreOrientation = requiredString(
    value.restoreOrientation,
    `fixtures.${platform}.rotation.restoreOrientation`,
  );
  if (restoreOrientation !== "portrait") {
    fail(
      `fixtures.${platform}.rotation.restoreOrientation must be portrait so the lane leaves the fixture canonical`,
      "GOLDEN_FIXTURE_CONFIG_INVALID",
    );
  }
  return { orientation, restoreOrientation };
}

function parseFixture(value, platform) {
  if (!isRecord(value)) {
    fail(`fixtures.${platform} must be an object`, "GOLDEN_FIXTURE_CONFIG_INVALID");
  }
  if (!isRecord(value.scenarios)) {
    fail(`fixtures.${platform}.scenarios must be an object`, "GOLDEN_FIXTURE_CONFIG_INVALID");
  }
  const expectedName = optionalString(value.expectedName, `fixtures.${platform}.expectedName`);
  const expectedOsVersion = optionalString(
    value.expectedOsVersion,
    `fixtures.${platform}.expectedOsVersion`,
  );
  const scenarios = Object.fromEntries(
    REQUIRED_GOLDEN_SCENARIOS.map((scenario) => [
      scenario,
      requiredRecipeId(value.scenarios[scenario], `fixtures.${platform}.scenarios.${scenario}`),
    ]),
  );
  return {
    platform,
    serial: requiredString(value.serial, `fixtures.${platform}.serial`),
    app: requiredString(value.app, `fixtures.${platform}.app`),
    ...(expectedName ? { expectedName } : {}),
    ...(expectedOsVersion ? { expectedOsVersion } : {}),
    rotation: parseRotation(value.rotation, platform),
    scenarios,
  };
}

/** Parse the non-secret fixture contract held by the quarantined GitHub Environment.
 * It intentionally accepts no wildcard or "first available device" selector. */
export function parseGoldenFixtureConfig(value) {
  if (!isRecord(value)) {
    fail("golden fixture configuration must be an object", "GOLDEN_FIXTURE_CONFIG_INVALID");
  }
  if (value.schemaVersion !== GOLDEN_FIXTURE_SCHEMA_VERSION) {
    fail(
      `golden fixture configuration requires schemaVersion ${GOLDEN_FIXTURE_SCHEMA_VERSION}`,
      "GOLDEN_FIXTURE_CONFIG_INVALID",
    );
  }
  if (!isRecord(value.fixtures)) {
    fail(
      "golden fixture configuration requires fixtures.android and fixtures.ios",
      "GOLDEN_FIXTURE_CONFIG_INVALID",
    );
  }
  const android = parseFixture(value.fixtures.android, "android");
  const ios = parseFixture(value.fixtures.ios, "ios");
  if (android.serial === ios.serial) {
    fail(
      "Android and iOS golden fixtures must use distinct serials",
      "GOLDEN_FIXTURE_CONFIG_INVALID",
    );
  }
  const scheduling = isRecord(value.scheduling) ? value.scheduling : {};
  const minimumOverlapMs = scheduling.minimumOverlapMs ?? 750;
  if (!Number.isInteger(minimumOverlapMs) || minimumOverlapMs < 1 || minimumOverlapMs > 30_000) {
    fail(
      "scheduling.minimumOverlapMs must be an integer between 1 and 30000",
      "GOLDEN_FIXTURE_CONFIG_INVALID",
    );
  }
  return {
    schemaVersion: GOLDEN_FIXTURE_SCHEMA_VERSION,
    fixtures: { android, ios },
    scheduling: { minimumOverlapMs },
  };
}

/** Read the config from an explicitly supplied JSON value or file. An absent config
 * is intentionally distinguishable from a malformed one so local optional probes can skip. */
export async function loadGoldenFixtureConfig(env = process.env, options = {}) {
  const inline = env.GOLDEN_FIXTURE_CONFIG?.trim();
  const file = env.GOLDEN_FIXTURE_CONFIG_FILE?.trim();
  if (inline && file) {
    fail(
      "Set only one of GOLDEN_FIXTURE_CONFIG or GOLDEN_FIXTURE_CONFIG_FILE",
      "GOLDEN_FIXTURE_CONFIG_INVALID",
    );
  }
  if (!inline && !file) return undefined;
  let source = inline;
  if (file) {
    const reader = options.readFile ?? readFile;
    try {
      source = await reader(file, "utf8");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      fail(
        `Could not read GOLDEN_FIXTURE_CONFIG_FILE: ${message}`,
        "GOLDEN_FIXTURE_CONFIG_INVALID",
      );
    }
  }
  try {
    return parseGoldenFixtureConfig(JSON.parse(source));
  } catch (error) {
    if (error instanceof GoldenAcceptanceError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    fail(`GOLDEN_FIXTURE_CONFIG is not valid JSON: ${message}`, "GOLDEN_FIXTURE_CONFIG_INVALID");
  }
}

export function fixtureFingerprint(serial) {
  return createHash("sha256").update(serial).digest("hex").slice(0, 16);
}

export function isReadyFixtureDevice(device) {
  if (!isRecord(device)) return false;
  if (device.platform !== "android" && device.platform !== "ios") return false;
  if (device.booted !== true) return false;
  if (["offline", "unauthorized"].includes(String(device.connectionState ?? "").toLowerCase())) {
    return false;
  }
  if (device.developerMode === "disabled" || device.developerServicesAvailable === false)
    return false;
  return typeof device.serial === "string" && device.serial.trim().length > 0;
}

export function isPhysicalFixtureDevice(device) {
  return isRecord(device) && device.kind === "Physical device";
}

/** Match every configured fixture exactly. An attached device is never a substitute for a missing fixture. */
export function selectConfiguredFixtures(devices, config) {
  if (!Array.isArray(devices)) {
    fail("Relay returned a malformed /devices response", "GOLDEN_DEVICE_INVENTORY_INVALID");
  }
  const selected = Object.values(config.fixtures).map((fixture) => {
    const sameSerial = devices.filter(
      (device) => isRecord(device) && device.serial === fixture.serial,
    );
    const platformMatches = sameSerial.filter(
      (candidate) => candidate.platform === fixture.platform,
    );
    const device = platformMatches[0];
    const tag = `${fixture.platform} fixture ${fixtureFingerprint(fixture.serial)}`;
    if (!device) {
      const mismatch = sameSerial.length
        ? ` (attached as ${sameSerial[0]?.platform ?? "unknown"})`
        : "";
      fail(
        `Required ${tag} is absent${mismatch}; refusing to substitute another target.`,
        "GOLDEN_FIXTURE_MISSING",
      );
    }
    if (platformMatches.length !== 1) {
      fail(
        `Required ${tag} was reported more than once; refusing an ambiguous fixture inventory.`,
        "GOLDEN_FIXTURE_AMBIGUOUS",
      );
    }
    if (!isPhysicalFixtureDevice(device)) {
      fail(
        `Required ${tag} is ${typeof device.kind === "string" ? device.kind : "not classified as hardware"}; strict acceptance requires a Physical device.`,
        "GOLDEN_FIXTURE_NOT_HARDWARE",
      );
    }
    if (!isReadyFixtureDevice(device)) {
      fail(
        `Required ${tag} is attached but not ready; unlock, authorize, enable developer services, then retry.`,
        "GOLDEN_FIXTURE_NOT_READY",
      );
    }
    if (fixture.expectedName && device.name !== fixture.expectedName) {
      fail(
        `Required ${tag} name does not match the configured fixture identity.`,
        "GOLDEN_FIXTURE_IDENTITY_MISMATCH",
      );
    }
    if (fixture.expectedOsVersion && device.osVersion !== fixture.expectedOsVersion) {
      fail(
        `Required ${tag} OS version does not match the configured fixture identity.`,
        "GOLDEN_FIXTURE_IDENTITY_MISMATCH",
      );
    }
    return { fixture, device };
  });
  const configured = new Set(
    Object.values(config.fixtures).map((fixture) => `${fixture.platform}:${fixture.serial}`),
  );
  const unexpectedHardware = devices.filter(
    (device) =>
      isPhysicalFixtureDevice(device) &&
      (device.platform === "android" || device.platform === "ios") &&
      !configured.has(`${device.platform}:${device.serial}`),
  );
  if (unexpectedHardware.length) {
    const identities = unexpectedHardware
      .map((device) =>
        typeof device.serial === "string"
          ? `${device.platform}:${fixtureFingerprint(device.serial)}`
          : `${device.platform}:unidentified`,
      )
      .join(", ");
    fail(
      `Unexpected physical hardware is attached (${identities}); the quarantined lane permits only configured fixtures.`,
      "GOLDEN_FIXTURE_UNEXPECTED",
    );
  }
  return selected;
}

export function isSemanticTarget(target) {
  return (
    isRecord(target) &&
    Boolean(target.identifier || target.ref || target.label || target.text || target.relation)
  );
}

export function isPointOnlyTarget(target) {
  return isRecord(target) && Boolean(target.point) && !isSemanticTarget(target);
}

/** Every target candidate the executor may use for a tap. Evidence candidates
 * are executable fallbacks too, not passive documentation, so a semantic-only
 * scenario must review them with the same care as fallbackTargets. */
function tapTargetCandidates(step) {
  const evidenceCandidates = Array.isArray(step?.evidence?.candidates)
    ? step.evidence.candidates.map((candidate) => candidate?.target)
    : [];
  return [
    step?.target,
    ...(Array.isArray(step?.fallbackTargets) ? step.fallbackTargets : []),
    ...evidenceCandidates,
  ].filter(isRecord);
}

function hasCoordinateEscapeHatch(step) {
  return tapTargetCandidates(step).some((target) => Boolean(target.point));
}

function isAssertionStep(step) {
  return ["expect", "expect-screen", "expect-set", "wait-for"].includes(step?.kind);
}

// These steps can hide an unbounded or dynamically selected sequence of
// physical inputs. Golden recipes are fixed acceptance fixtures, so require
// their direct, reviewable equivalents instead of trying to infer proof
// brackets through a reusable recipe, tour, or imperative helper.
const OPAQUE_GOLDEN_STEP_KINDS = new Set([
  "capture-surface",
  "tour",
  "flow",
  "module",
  "branch",
  "repeat",
  "script",
  "pause",
  "review",
  "network",
  "logs",
]);

function assertDeterministicGoldenSteps(recipe, label) {
  recipe.steps.forEach((step, index) => {
    if (!isRecord(step) || typeof step.kind !== "string") {
      fail(
        `${label} has a malformed step at index ${index + 1}.`,
        "GOLDEN_RECIPE_CONTRACT_INVALID",
      );
    }
    if (step.optional === true || step.when || step.check) {
      fail(
        `${label} step ${index + 1} must not be optional, conditional, or campaign-generated in strict acceptance.`,
        "GOLDEN_RECIPE_CONTRACT_INVALID",
      );
    }
    if (OPAQUE_GOLDEN_STEP_KINDS.has(step.kind)) {
      fail(
        `${label} step ${index + 1} uses ${step.kind}, which can hide physical inputs; golden recipes must be flat and directly reviewable.`,
        "GOLDEN_RECIPE_CONTRACT_INVALID",
      );
    }
  });
}

/**
 * A golden recipe is deliberately smaller than the full authoring vocabulary,
 * but every step here can send input or otherwise change the target. Treating
 * `reveal` or a device/app command as "setup" would leave an unproven gap in
 * exactly the class of interactions this lane is meant to protect.
 */
function isPhysicalInputStep(step) {
  return [
    "tap",
    "type",
    "scroll",
    "reveal",
    "swipe",
    "key",
    "clipboard",
    "app",
    "device",
    "rotate",
    "settings",
    "location",
    "permission",
    "alert",
  ].includes(step?.kind);
}

/**
 * Require an entrance and exit assertion around every device-changing step.
 * An assertion between two inputs can be the first input's exit and the
 * second input's entrance, but no input may borrow proof from after another
 * input. This prevents a recipe from proving only its final state after a
 * chain of unobserved mutations.
 */
function assertProofEnvelope(recipe, label) {
  const steps = Array.isArray(recipe.steps) ? recipe.steps : [];
  const inputIndexes = steps.flatMap((step, index) => (isPhysicalInputStep(step) ? [index] : []));
  if (!inputIndexes.length) {
    fail(
      `${label} must contain a physical input between its entrance and exit proof.`,
      "GOLDEN_RECIPE_CONTRACT_INVALID",
    );
  }
  inputIndexes.forEach((inputIndex, index) => {
    const previousInputIndex = inputIndexes[index - 1] ?? -1;
    const nextInputIndex = inputIndexes[index + 1] ?? steps.length;
    const entrance = steps.slice(previousInputIndex + 1, inputIndex).some(isAssertionStep);
    const exit = steps.slice(inputIndex + 1, nextInputIndex).some(isAssertionStep);
    if (!entrance || !exit) {
      fail(
        `${label} must contain an assertion before and after physical input ${index + 1}; no later input may occur before that exit proof.`,
        "GOLDEN_RECIPE_CONTRACT_INVALID",
      );
    }
  });
}

/** Validate the declared recipe shape before any fixture is mutated. These are
 * intentionally structural checks; the run itself must still prove the actual native behavior. */
export function validateGoldenScenarioRecipe(recipe, scenario, minimumOverlapMs) {
  if (!isRecord(recipe) || typeof recipe.id !== "string" || !Array.isArray(recipe.steps)) {
    fail(`Golden ${scenario} recipe is malformed`, "GOLDEN_RECIPE_CONTRACT_INVALID");
  }
  if (recipe.quarantined) {
    fail(
      `Golden recipe ${recipe.id} is quarantined and cannot pass acceptance.`,
      "GOLDEN_RECIPE_QUARANTINED",
    );
  }
  const steps = recipe.steps;
  const taps = steps.filter((step) => step?.kind === "tap");
  assertDeterministicGoldenSteps(recipe, `Golden ${scenario} recipe ${recipe.id}`);
  assertProofEnvelope(recipe, `Golden ${scenario} recipe ${recipe.id}`);
  switch (scenario) {
    case "proofReplay":
      return;
    case "delayedSemanticFallback": {
      const valid = steps.some(
        (step) =>
          step?.kind === "tap" &&
          isSemanticTarget(step.target) &&
          !step.target?.point &&
          Array.isArray(step.fallbackTargets) &&
          step.fallbackTargets.some(isPointOnlyTarget),
      );
      if (!valid) {
        fail(
          `Golden delayed-semantic-fallback recipe ${recipe.id} needs a semantic tap with an explicit point-only fallback.`,
          "GOLDEN_RECIPE_CONTRACT_INVALID",
        );
      }
      return;
    }
    case "semanticInput": {
      const valid =
        taps.length > 0 &&
        taps.every((step) => isSemanticTarget(step.target) && !hasCoordinateEscapeHatch(step)) &&
        taps.some(
          (step) =>
            step?.kind === "tap" &&
            isSemanticTarget(step.target) &&
            !hasCoordinateEscapeHatch(step),
        );
      if (!valid) {
        fail(
          `Golden semantic-input recipe ${recipe.id} needs a semantic tap without a coordinate escape hatch.`,
          "GOLDEN_RECIPE_CONTRACT_INVALID",
        );
      }
      return;
    }
    case "pointInput": {
      const valid =
        taps.length > 0 &&
        taps.every(
          (step) =>
            isPointOnlyTarget(step.target) && tapTargetCandidates(step).every(isPointOnlyTarget),
        ) &&
        taps.some(
          (step) =>
            step?.kind === "tap" &&
            isPointOnlyTarget(step.target) &&
            tapTargetCandidates(step).every(isPointOnlyTarget),
        );
      if (!valid) {
        fail(
          `Golden point-input recipe ${recipe.id} needs an explicit point-only tap.`,
          "GOLDEN_RECIPE_CONTRACT_INVALID",
        );
      }
      return;
    }
    case "parallelScheduling": {
      const hasDelay = steps.some(
        (step) => step?.kind === "sleep" && Number(step.ms) >= minimumOverlapMs,
      );
      if (!hasDelay) {
        fail(
          `Golden parallel scheduling recipe ${recipe.id} needs a sleep of at least ${minimumOverlapMs}ms so independent lanes can be measured.`,
          "GOLDEN_RECIPE_CONTRACT_INVALID",
        );
      }
      return;
    }
    case "runnerKillMidSession":
    case "ddiUnmountRecover": {
      // Both recovery lanes must prove control survives the host-side
      // disruption through the public device command, not a hidden helper.
      const hasDeviceStep = steps.some((step) => step?.kind === "device");
      if (!hasDeviceStep) {
        fail(
          `Golden ${scenario} recipe ${recipe.id} needs an explicit device step so the recovery is exercised through Relay's public control surface.`,
          "GOLDEN_RECIPE_CONTRACT_INVALID",
        );
      }
      return;
    }
    case "appHandoffToSettings": {
      // The handoff lane proves semantic control across app boundaries: an
      // in-app input, then the Settings surface, then proof Relay can still
      // read named controls there.
      const hasAppOpen = steps.some(
        (step) => step?.kind === "app" && step.action === "open",
      );
      const hasSettings = steps.some((step) => step?.kind === "settings");
      if (!hasAppOpen || !hasSettings) {
        fail(
          `Golden app-handoff recipe ${recipe.id} needs an explicit app open and a settings step; a single-surface recipe cannot prove the handoff.`,
          "GOLDEN_RECIPE_CONTRACT_INVALID",
        );
      }
      return;
    }
    default:
      fail(`Unknown golden scenario ${scenario}`, "GOLDEN_RECIPE_CONTRACT_INVALID");
  }
}

export function errorRecord(error) {
  return {
    name: error instanceof Error ? error.name : "Error",
    message: error instanceof Error ? error.message : String(error),
    ...(error instanceof GoldenAcceptanceError ? { code: error.code } : {}),
  };
}

/** Public seam for the golden-device script and its offline contract tests. */
export {
  fixtureFingerprint,
  GoldenAcceptanceError,
  GOLDEN_FIXTURE_SCHEMA_VERSION,
  isPhysicalFixtureDevice,
  isReadyFixtureDevice,
  loadGoldenFixtureConfig,
  parseGoldenFixtureConfig,
  REQUIRED_GOLDEN_SCENARIOS,
  selectConfiguredFixtures,
  validateGoldenScenarioRecipe,
} from "./golden-device-contract.mjs";
export { createGoldenApi, GoldenArtifactWriter } from "./golden-device-transport.mjs";
export {
  GOLDEN_HOST_FAULT_SCENARIOS,
  validateGoldenFaultReceipt,
} from "./golden-device-fault-contract.mjs";
export { runGoldenFixtureAcceptance } from "./golden-device-runner.mjs";

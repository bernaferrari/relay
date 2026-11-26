export * from "./model.js";
export { AppMapDomainError } from "./errors.js";
export { validateAppMap } from "./validation.js";
export { commitAppMapChanges } from "./batch-operations.js";
export {
  appMapToCollaborationDocument,
  collaborationEntitiesFor,
  collaborationChangesToBatchChanges,
} from "./collaboration-document.js";
export { removeAppMapNote, saveAppMapNote } from "./note-operations.js";
export { removeAppMapGroup, saveAppMapGroup } from "./group-operations.js";
export {
  addAppMapScreen,
  refreshAppMapScreen,
  removeAppMapScreen,
  updateAppMapScreen,
  observeAppMapScreenAlias,
  type AppMapScreenAliasCapture,
  type AppMapScreenAliasObservationResult,
  type AppMapScreenVariantCaptureInput,
} from "./screen-operations.js";
export {
  consolidateAppMapScreens,
  previewScreenConsolidation,
  type ConsolidateScreensInput,
} from "./screen-consolidation.js";
export {
  connectAppMapScreens,
  removeAppMapConnection,
  updateAppMapConnection,
} from "./connection-operations.js";
export { previewRoutineImpact } from "./routine-operations.js";
export { computeDiffImpact, matchedDiffEntities, type DiffImpactInput } from "../diff-impact.js";
export {
  connectionRouteCost,
  selectEquivalentDirectConnection,
  type ConnectionRouteCost,
} from "./app-map-route-cost.js";
export { recordAppMapRun, type RecordAppMapRunInput } from "./run-operations.js";
export {
  approveAppMapProposal,
  rejectAppMapProposal,
  revertAppMapRepairProposal,
} from "./proposal-operations.js";
export { deriveTestProposalReview, materializeProposalReviews } from "./proposal-review.js";
export {
  proposalConflictsSince,
  proposalEntityKeys,
  scenarioTestEditEntityKeys,
} from "./proposal-conflicts.js";
export {
  attachAppMapCaseStack,
  editAppMapScenarioTest,
  removeAppMapFlow,
  removeAppMapCaseStack,
  removeAppMapVariable,
  removeAppMapTest,
  removeAppMapCombine,
  removeAppMapRoutine,
  saveAppMapFlow,
  saveAppMapCaseStack,
  saveAppMapVariable,
  saveAppMapTest,
  saveAppMapCombine,
  saveAppMapRoutine,
  submitAppMapProposal,
  updateAppMap,
  restoreAppMapScenarioTest,
} from "./entity-operations.js";
export {
  appendAppMapTestMutationHistory,
  readAppMapTestMutationHistory,
  sameAppMapTestContent,
  setAppMapTestHistoryCursor,
} from "./test-history.js";
export type {
  AppMapTestMutationHistory,
  AppMapTestMutationHistoryEntry,
} from "./test-history-model.js";
export { serializeAppMap } from "./serialization.js";
export {
  discoveryLandChanges,
  proposalFromDiscovery,
  proposalFromObservedEdge,
} from "./observation-proposal.js";
export { compileIntentWalk, type IntentWalkResult } from "./intent-walk.js";
export { observeAppMapRuns, projectObservedRuns } from "./app-map-observed.js";
export {
  growAppMapFromRun,
  growAppMapsFromPastRuns,
  registerScreenNamer,
} from "./app-map-run-growth.js";
export {
  draftTestSteps,
  registerTestStepDrafter,
  type DraftedTest,
  type DraftedTestStep,
} from "../test-step-drafting.js";
export {
  connectionIdsFromProposal,
  connectionProofOutcomeUnknownDiagnostic,
  proveConnectionOnDevice,
  type ConnectionProofOutcomeUnknownDiagnostic,
  type ConnectionProofRuntime,
} from "./keep-prove.js";
export {
  proposeNavigationFromObservation,
  type NavigationObservationAction,
  type NavigationObservationResult,
  type ProposedNavigationEdge,
} from "./navigation-observation.js";
export {
  AppMapTestStepOperationError,
  addScenarioTestStep,
  applyScenarioTestStepEdits,
  bindScenarioTestStep,
  findScenarioTestStep,
  patchScenarioTestStep,
  removeScenarioTestStep,
  reorderScenarioTestSteps,
  selectScenarioTestStep,
  unbindScenarioTestStep,
  type AppMapScenarioTestEdit,
  type AppMapTestStepBranch,
  type AppMapTestStepLocation,
  type AppMapTestStepOperationErrorCode,
  type AppMapTestStepPatch,
  type AppMapTestStepPlacement,
} from "./test-step-operations.js";
export { freezeMissingBrowserCaseProfiles } from "./browser-profile-freeze.js";
export {
  applyAppMapScreenCaptureReview,
  CAPTURE_REFRESH_APPLIED_REASON,
  hasPendingCaptureRefresh,
  isCaptureRefreshProposal,
  settleCaptureRefreshProposals,
} from "./capture-refresh.js";
export {
  commitAppMapRecording,
  commitAppMapScreenCapture,
  findAppMapCaptureScreen,
  reviewAppMapScreenCapture,
} from "./recording-operations.js";
export type {
  AppMapRecordingInput,
  AppMapRecordingResult,
  AppMapScreenCaptureInput,
  AppMapScreenCaptureResult,
  AppMapScreenCaptureReview,
} from "./recording-operations.js";

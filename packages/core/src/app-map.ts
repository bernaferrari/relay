export * from "./app-map/model.js";
export { AppMapDomainError } from "./app-map/errors.js";
export { validateAppMap } from "./app-map/validation.js";
export { commitAppMapChanges } from "./app-map/batch-operations.js";
export {
  appMapToCollaborationDocument,
  collaborationEntitiesFor,
  collaborationChangesToBatchChanges,
} from "./app-map/collaboration-document.js";
export { removeAppMapNote, saveAppMapNote } from "./app-map/note-operations.js";
export { removeAppMapGroup, saveAppMapGroup } from "./app-map/group-operations.js";
export {
  addAppMapScreen,
  removeAppMapScreen,
  updateAppMapScreen,
  observeAppMapScreenAlias,
  type AppMapScreenAliasCapture,
  type AppMapScreenAliasObservationResult,
  type AppMapScreenVariantCaptureInput,
} from "./app-map/screen-operations.js";
export {
  consolidateAppMapScreens,
  previewScreenConsolidation,
  type ConsolidateScreensInput,
} from "./app-map/screen-consolidation.js";
export {
  connectAppMapScreens,
  removeAppMapConnection,
  updateAppMapConnection,
} from "./app-map/connection-operations.js";
export { previewRoutineImpact } from "./app-map/routine-operations.js";
export { computeDiffImpact, matchedDiffEntities, type DiffImpactInput } from "./diff-impact.js";
export {
  connectionRouteCost,
  selectEquivalentDirectConnection,
  type ConnectionRouteCost,
} from "./app-map-route-cost.js";
export { recordAppMapRun, type RecordAppMapRunInput } from "./app-map/run-operations.js";
export {
  approveAppMapProposal,
  rejectAppMapProposal,
  revertAppMapRepairProposal,
} from "./app-map/proposal-operations.js";
export { deriveTestProposalReview, materializeProposalReviews } from "./app-map/proposal-review.js";
export {
  proposalConflictsSince,
  proposalEntityKeys,
  scenarioTestEditEntityKeys,
} from "./app-map/proposal-conflicts.js";
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
} from "./app-map/entity-operations.js";
export { serializeAppMap } from "./app-map/serialization.js";
export {
  discoveryLandChanges,
  proposalFromDiscovery,
  proposalFromObservedEdge,
} from "./app-map/observation-proposal.js";
export { compileIntentWalk, type IntentWalkResult } from "./app-map/intent-walk.js";
export {
  connectionIdsFromProposal,
  connectionProofOutcomeUnknownDiagnostic,
  proveConnectionOnDevice,
  type ConnectionProofOutcomeUnknownDiagnostic,
  type ConnectionProofRuntime,
} from "./app-map/keep-prove.js";
export {
  proposeNavigationFromObservation,
  type NavigationObservationAction,
  type NavigationObservationResult,
  type ProposedNavigationEdge,
} from "./app-map/navigation-observation.js";
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
} from "./app-map/test-step-operations.js";
export {
  commitAppMapRecording,
  commitAppMapScreenCapture,
  findAppMapCaptureScreen,
  reviewAppMapScreenCapture,
} from "./app-map/recording-operations.js";
export type {
  AppMapRecordingInput,
  AppMapRecordingResult,
  AppMapScreenCaptureInput,
  AppMapScreenCaptureResult,
  AppMapScreenCaptureReview,
} from "./app-map/recording-operations.js";

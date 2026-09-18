export { RelayV2App } from "./app";
export {
  createGoalProductService,
  type GoalPromotionInput,
  type GoalProductService,
  type GoalRunResult,
  type GoalStartInput,
} from "./data/goal-product-service";
export { createRelayQueryClient } from "./data/query-client";
export {
  createAppResourcesProductService,
  type AppResourcesProductService,
  type AppVersionProductService,
  type BrowserAccountProductService,
  type OperationalAppResourcesProductService,
  type ProductAppVersion,
  type ProductAppVersionInput,
  type ProductBrowserAccount,
  type ProductBrowserAccountInput,
} from "./data/app-resources-product-service";
export {
  createDeviceProductService,
  deviceQueryKeys,
  projectDevices,
  type DeviceProductService,
  type ProductDevice,
  type ProductDeviceRecovery,
  type ProductDeviceStatus,
} from "./data/device-product-service";
export {
  createSettingsProductService,
  settingsQueryKeys,
  settingsCategories,
  type SettingsCategory,
  type SettingsProductService,
} from "./data/settings-product-service";
export {
  composeProductIssue,
  createIntegrationsProductService,
  type IntegrationsProductService,
  type ProductIntegration,
  type ProductIntegrationProvider,
  type ProductIntegrationState,
  type ProductIssueDraft,
  type ProductIssueSource,
} from "./data/integration-product-service";
export {
  createRecordingEditAdapter,
  createRecordingProductService,
  type RecordingEditAdapter,
  type RecordingEditProductService,
  type ProductAppOption,
  type RecordingEvidencePreview,
  type ProductRecordingRecovery,
  type ProductRecordingState,
  type RecordingProductService,
} from "./data/recording-product-service";
export {
  createSessionProductService,
  projectSessionDetail,
  projectSessionSummary,
  sessionQueryKeys,
  type ProductSessionActivity,
  type ProductSessionDetail,
  type ProductSessionLease,
  type ProductSessionSummary,
  type ProductSessionTakeSummary,
  type SessionListOptions,
  type SessionProductService,
} from "./data/session-product-service";
export {
  createRunProductService,
  type ProductRunReportOverview,
  type ProductRunReview,
  type ProductVisualBaselineApproval,
  type ProductVisualReviewResult,
  type ProductTestSummary,
  type ReportEvidenceSection,
  type RunProductService,
} from "./data/run-product-service";
export {
  createCatalogProductService,
  type CatalogProductService,
} from "./data/catalog-product-service";
export type { ProductMapOverview, ProductMapProposal } from "./data/map-product-service";
export {
  attachStabilityClusterIds,
  createStabilityProductService,
  stabilityMaintenanceRecommendations,
  stabilitySampleFromRun,
  stabilitySamplesFromBatch,
  stabilitySamplesFromRuns,
  summarizeProductStability,
  type ProductStabilityAppBucket,
  type ProductStabilityBucket,
  type ProductStabilityClusterBucket,
  type ProductStabilityConfidence,
  type ProductStabilityOwner,
  type ProductStabilityRecommendation,
  type ProductStabilitySample,
  type ProductStabilityScope,
  type ProductStabilitySignal,
  type ProductStabilitySummary,
  type ProductStabilitySummaryInput,
  type ProductStabilityTrend,
  type StabilityProductService,
} from "./data/stability-product-service";
export {
  createTestEditorProductService,
  documentFromMap,
  type ProductTestEditorDocument,
  type ProductTestHistoryItem,
  type ProductTestRepair,
  type TestEditorProductService,
} from "./data/test-editor-product-service";
export {
  createLiveTestEditorProductService,
  type LiveTestEditorCapabilities,
  type LiveTestEditorProductService,
  type LiveTestEditorSession,
} from "./data/live-test-editor-product-service";
export {
  createBrowserSpacesProductService,
  projectProductBrowserAuthFixture,
  projectProductBrowserSpace,
  type BrowserSpacesProductService,
  type ProductBrowserAuthFixture,
  type ProductBrowserAuthResult,
  type ProductBrowserSpace,
  type ProductBrowserSpaceInput,
  type ProductCompareSet,
  type ProductCompareSetInput,
} from "./data/browser-spaces-product-service";
export {
  createChangeProductService,
  type ChangeNameIndex,
  type ChangeProductService,
  type ProductChangeDetail,
} from "./data/change-product-service";
export {
  assessProductAuthenticationFixture,
  createSuiteProfileProductService,
  projectProductEnvironmentProfiles,
  projectProductSuite,
  type ProductAuthenticationFixture,
  type ProductAuthenticationPreflight,
  type ProductBuildOption,
  type ProductEnvironmentPreflight,
  type ProductEnvironmentProfile,
  type ProductSuite,
  type ProductSuiteEditor,
  type ProductSuiteInput,
  type ProductSuiteIssue,
  type ProductSuitePreview,
  type ProductSuiteTest,
  type SuiteProfileProductService,
} from "./data/suite-profile-product-service";
export {
  applyColorScheme,
  validColorScheme,
  type ColorSchemePreference,
} from "./data/appearance-preference";
export { createWebPlatform } from "./platform/web-platform";
export type { DesktopUpdateState, Platform, PlatformStorage } from "./platform/types";
export type {
  LiveTargetInput,
  LiveTargetMount,
  LiveTargetSession,
  LiveTargetSnapshot,
  LiveTargetStatus,
} from "./data/live-target-session";
export { createAppRouter, type AppRouter, type AppRouterContext } from "./router/create-router";
export {
  routeContract,
  routeContractForPath,
  routeContracts,
  type ProductRouteId,
  type RouteContract,
} from "./router/route-contract";

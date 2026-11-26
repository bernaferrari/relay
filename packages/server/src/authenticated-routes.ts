import type { captureScreenshot } from "@relay/core";
import { handleE2EProjectRoute } from "./e2e/e2e-project-routes.js";
import { handleEverydayRoute } from "./everyday-routes.js";
import {
  handleAuthoringActionReplace,
  handleAuthoringRoute,
} from "./authoring/authoring-routes.js";
import { handleDiscoveryRoute } from "./discovery-routes.js";
import { handlePresenceRoute } from "./presence-routes.js";
import { handleSettingsRoute } from "./settings-routes.js";
import { handleTargetRoute } from "./target/target-routes.js";
import { handleManualTargetRoute } from "./manual-target-routes.js";
import { handleTargetObservationRoute } from "./target/target-observation-route.js";
import { handleControlPlaneRoute } from "./control-plane-routes.js";
import { handleWorkspaceRoute } from "./workspace-routes.js";
import { handleInteractionRoute } from "./interaction-routes.js";
import { dispatchGoalRoute, type GoalRouteRuntimeFactory } from "./goal/goal-routes.js";
import { handleStepRunRoute, type StepRunRouteRuntime } from "./step-run-route.js";
import { handleAndroidAvdRoute } from "./android/android-avd-routes.js";
import { handlePrimaryOperationRoutes } from "./primary-operation-routes.js";
import type { PrimaryOperationRouteRuntimes } from "./primary-operation-routes.js";
import type { ServerRouteInput } from "./server-route-input.js";
import { handleSystemRoute } from "./system-routes.js";
import { handleActionRunRoute } from "./action-run-route.js";
import { handleServerLivenessRoute, type ServerLivenessState } from "./server-liveness-routes.js";
import { handleJobRoute } from "./job-routes.js";
import { handleCaptureReferenceRoute } from "./capture-reference-routes.js";
import { handleLiveRunRoute } from "./live/live-run-routes.js";
import { handleRunRoute, type RunRouteRuntime } from "./run/run-routes.js";
import type { createSseHub } from "./sse.js";
import type { streamTargetVideo } from "./target/target-video-stream.js";

type RoutedRequestServices = {
  goal?: GoalRouteRuntimeFactory;
  primary: PrimaryOperationRouteRuntimes;
  stepRun?: Partial<StepRunRouteRuntime>;
  run?: Partial<RunRouteRuntime>;
  sse: ReturnType<typeof createSseHub>;
  liveness: ServerLivenessState;
  liveVideoStream: typeof streamTargetVideo;
  captureTargetScreenshot: typeof captureScreenshot;
};

type AuthenticatedRoute = (
  input: ServerRouteInput,
  services: RoutedRequestServices,
) => boolean | Promise<boolean>;

const authenticatedRoutes: readonly AuthenticatedRoute[] = [
  ({ request, response, method, pathname, scope }, services) =>
    dispatchGoalRoute(request, response, method, pathname, scope, services.goal),
  (input, { primary }) => handlePrimaryOperationRoutes({ ...input, runtimes: primary }),
  handleAuthoringActionReplace,
  (input, { primary }) => handleAuthoringRoute({ ...input, authoringRuntime: primary.authoring }),
  handlePresenceRoute,
  handleDiscoveryRoute,
  handleSettingsRoute,
  handleInteractionRoute,
  (input, { stepRun }) => handleStepRunRoute({ ...input, runtime: stepRun }),
  (input, { sse, liveness }) => handleServerLivenessRoute({ ...input, sse, liveness }),
  handleAndroidAvdRoute,
  handleTargetRoute,
  handleTargetObservationRoute,
  handleControlPlaneRoute,
  (input, { primary }) => handleJobRoute({ ...input, runtime: primary.jobs }),
  handleWorkspaceRoute,
  (input, { primary }) => handleActionRunRoute({ ...input, runtime: primary.jobs }),
  (input, { liveVideoStream, captureTargetScreenshot }) =>
    handleManualTargetRoute({ ...input, liveVideoStream, captureTargetScreenshot }),
  handleE2EProjectRoute,
  handleEverydayRoute,
  handleLiveRunRoute,
  handleCaptureReferenceRoute,
  (input, { run }) => handleRunRoute({ ...input, runtime: run }),
  handleSystemRoute,
];

export async function dispatchAuthenticatedRoute(
  input: ServerRouteInput,
  services: RoutedRequestServices,
): Promise<boolean> {
  for (const route of authenticatedRoutes) {
    if (await route(input, services)) return true;
  }
  return false;
}

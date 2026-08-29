/**
 * Physical iOS app activation is deliberately outside the generic SDK open
 * path: sidecar launch can work while XCTest is unavailable, but its outcome
 * is a one-dispatch mutation rather than a retryable request.
 */
import { getExecutingJobId } from "./control.js";
import { launchIosAppOutsideXctest, resolveIosLaunchBundleId } from "./ios-app-launch.js";
import { dispatchSupervisedIosMutation, runIosMutationOnce } from "./ios-mutation-policy.js";
import { runTargetMutation } from "./target-control.js";
import type { DeviceTargetContext } from "./target-context.js";

type OpenPhysicalIosAppInput = {
  context: DeviceTargetContext;
  app: string;
  relaunch: boolean;
  rememberApplication: (app: string) => Promise<void>;
};

type IosAppOpenRuntime = {
  resolveBundleId: typeof resolveIosLaunchBundleId;
  launch: typeof launchIosAppOutsideXctest;
};

const defaultRuntime: IosAppOpenRuntime = {
  resolveBundleId: resolveIosLaunchBundleId,
  launch: launchIosAppOutsideXctest,
};

export async function openPhysicalIosApp(
  input: OpenPhysicalIosAppInput,
  runtime: IosAppOpenRuntime = defaultRuntime,
): Promise<void> {
  // Input validation is local and conclusively pre-dispatch. The sidecar
  // activation below is the one operation guarded as an exact-once mutation.
  const bundleId = runtime.resolveBundleId(input.app);
  const launched = await runTargetMutation(input.context.serial, getExecutingJobId(), () =>
    runIosMutationOnce(input.context.serial, "app-open", () =>
      dispatchSupervisedIosMutation(input.context.serial, () =>
        runtime.launch(input.context.serial, bundleId, {
          relaunch: input.relaunch,
        }),
      ),
    ),
  );
  await input.rememberApplication(launched.bundleId);
  // Do not prime XCTest here: agent-device `apps.open` can activate the app,
  // making it a second physical launch. Later snapshot/recovery owns session
  // readiness explicitly, after this mutation has a reviewable outcome.
}

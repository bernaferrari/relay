import { A as Rect, O as Point } from "./sdk-contracts.js";
//#region packages/contracts/src/app-inventory.d.ts
type AppsFilter = 'user-installed' | 'all';
//#endregion
//#region packages/contracts/src/gesture-plan-types.d.ts
type GesturePointerCount = 1 | 2;
/** Selects one-pointer release timing without changing semantic gesture intent. */
type GestureExecutionProfile = 'endpoint-hold' | 'timed-pan';
type PointerTrajectorySample = {
  offsetMs: number;
  point: Point;
};
type PointerTrajectory = {
  pointerId: 0 | 1;
  samples: readonly PointerTrajectorySample[];
};
type SinglePointerTrajectory = {
  pointerId: 0;
  samples: readonly [PointerTrajectorySample, PointerTrajectorySample, ...PointerTrajectorySample[]];
};
type SinglePointerGesturePlan = {
  topology: 'single';
  intent: 'fling' | 'pan';
  executionProfile: GestureExecutionProfile;
  durationMs: number;
  viewport: Rect;
  pointers: readonly [SinglePointerTrajectory];
};
type MultiTouchGesturePlan = {
  topology: 'two';
  intent: 'pan' | 'pinch' | 'rotate' | 'transform';
  durationMs: number;
  viewport: Rect;
  pointers: readonly [PointerTrajectory, PointerTrajectory];
};
type GesturePlan = SinglePointerGesturePlan | MultiTouchGesturePlan;
//#endregion
export { PointerTrajectorySample as a, PointerTrajectory as i, GesturePointerCount as n, SinglePointerGesturePlan as o, MultiTouchGesturePlan as r, AppsFilter as s, GesturePlan as t };
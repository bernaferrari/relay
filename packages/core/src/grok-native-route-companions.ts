import type { AppMapNativeRouteCompanion } from "@relay/protocol";

function androidCompanion(testId: string): AppMapNativeRouteCompanion {
  return { platform: "android", appMapId: "grok-android", testId };
}

/** Honest grok.com → grok-android same-intent links. iOS stays absent: there is
 * no grok-ios App Map, grok-settings-ipad has zero Tests, and in-app Grok
 * Settings navigation must not be invented. Logged-out grok-web Tests are
 * omitted because the Android pack is signed-in. */
export const GROK_WEB_NATIVE_ROUTE_COMPANIONS: Readonly<
  Record<string, readonly AppMapNativeRouteCompanion[]>
> = {
  "test-grok-web-signed-in-home": [androidCompanion("test-grok-android-home-chrome")],
  "test-grok-web-signed-in-sidebar": [androidCompanion("test-grok-android-sidebar")],
  "test-grok-web-signed-in-imagine": [androidCompanion("test-grok-android-imagine")],
  "test-grok-web-signed-in-attach": [androidCompanion("test-grok-android-attach")],
  "test-grok-web-signed-in-settings": [androidCompanion("test-grok-android-settings")],
  "test-grok-web-signed-in-model-iterate": [androidCompanion("test-grok-android-models")],
  "test-grok-web-signed-in-new-chat": [androidCompanion("test-grok-android-new-chat")],
  "test-grok-web-signed-in-search": [androidCompanion("test-grok-android-search")],
  "test-grok-web-signed-in-logo": [androidCompanion("test-grok-android-logo")],
};

export function grokWebNativeRouteCompanions(
  testId: string,
): readonly AppMapNativeRouteCompanion[] | undefined {
  return GROK_WEB_NATIVE_ROUTE_COMPANIONS[testId];
}

import type { AppMapNativeRouteCompanion } from "@relay/protocol";

function androidCompanion(testId: string): AppMapNativeRouteCompanion {
  return { platform: "android", appMapId: "grok-android", testId };
}

function iosCompanion(testId: string): AppMapNativeRouteCompanion {
  return { platform: "ios", appMapId: "grok-ios", testId };
}

function androidAndIos(
  androidTestId: string,
  iosTestId: string,
): readonly AppMapNativeRouteCompanion[] {
  return [androidCompanion(androidTestId), iosCompanion(iosTestId)];
}

/** Honest grok.com → native same-intent links. Search stays Android-only:
 * grok-ios Conversations is not grok.com Search. Imagine stays Android-only:
 * SuperGrok iPad home has no `navigation.tab.imagine`, so grok-ios Imagine
 * is Unbound — do not invent the tab. Logged-out grok-web Tests are omitted
 * because the native packs are signed-in. Do not invent Grok Settings
 * navigation. */
export const GROK_WEB_NATIVE_ROUTE_COMPANIONS: Readonly<
  Record<string, readonly AppMapNativeRouteCompanion[]>
> = {
  "test-grok-web-signed-in-home": androidAndIos(
    "test-grok-android-home-chrome",
    "test-grok-ios-home-chrome",
  ),
  "test-grok-web-signed-in-sidebar": androidAndIos(
    "test-grok-android-sidebar",
    "test-grok-ios-sidebar",
  ),
  "test-grok-web-signed-in-imagine": [androidCompanion("test-grok-android-imagine")],
  "test-grok-web-signed-in-attach": androidAndIos(
    "test-grok-android-attach",
    "test-grok-ios-attach",
  ),
  "test-grok-web-signed-in-settings": androidAndIos(
    "test-grok-android-settings",
    "test-grok-ios-settings",
  ),
  "test-grok-web-signed-in-model-iterate": androidAndIos(
    "test-grok-android-models",
    "test-grok-ios-models",
  ),
  "test-grok-web-signed-in-new-chat": androidAndIos(
    "test-grok-android-new-chat",
    "test-grok-ios-new-chat",
  ),
  "test-grok-web-signed-in-search": [androidCompanion("test-grok-android-search")],
  "test-grok-web-signed-in-logo": androidAndIos("test-grok-android-logo", "test-grok-ios-logo"),
  "test-grok-web-signed-in-private-chat": androidAndIos(
    "test-grok-android-private-chat",
    "test-grok-ios-private-chat",
  ),
};

export function grokWebNativeRouteCompanions(
  testId: string,
): readonly AppMapNativeRouteCompanion[] | undefined {
  return GROK_WEB_NATIVE_ROUTE_COMPANIONS[testId];
}

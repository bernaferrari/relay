import { reviewAndroidTalkBack } from "@relay/protocol";
import type { TalkBackReviewItem } from "@relay/protocol";

export function conditionTextSuggestions(items: readonly TalkBackReviewItem[]): string[] {
  return [
    ...new Set(
      items.flatMap((item) => {
        const value = (item.text ?? item.name ?? "").trim();
        return value.length >= 2 && value.length <= 80 ? [value] : [];
      }),
    ),
  ].slice(0, 12);
}

/** Conditions belong to the app being tested, not notifications or the keyboard. */
export function snapshotConditionSuggestions(snapshot: {
  nodes?: readonly Record<string, unknown>[];
  foregroundApp?: string;
  treeApp?: string;
  app?: string;
}): string[] {
  const app = snapshot.foregroundApp ?? snapshot.treeApp ?? snapshot.app;
  const nodes = (snapshot.nodes ?? []).filter((node) => {
    if (node.visibleToUser === false || node.visible === false) return false;
    const owner = node.bundleId ?? node.packageName ?? node.app;
    return (
      typeof owner !== "string" || (app ? owner === app : !owner.startsWith("com.android.systemui"))
    );
  });
  return conditionTextSuggestions(reviewAndroidTalkBack(nodes).items);
}

import { rememberedTargetApplication } from "./device-target-applications.js";
import {
  isIosRunnerHostProbeTree,
  postAdoptedIosRunnerCommand,
  snapshotCompleteIosTreeForTargetApplication,
  unknownErrorMessage,
} from "./ios-runner-listener-command.js";
import { probeLiveIosRunnerListener } from "./ios-runner-listener.js";
import type { SnapshotNode } from "./device.js";
import type { StepTarget } from "./recipes.js";
import type { TargetContext } from "./target-context.js";

function normalized(value: string): string {
  return value.trim().toLowerCase().replaceAll(/\s+/g, " ");
}

/** Bare SDK find uses case-insensitive label/value/id substring matching. */
function matchesPresenceQuery(node: SnapshotNode, value: string): boolean {
  const query = normalized(value);
  return (
    Boolean(query) &&
    [node.label, node.value, node.identifier].some(
      (candidate) => typeof candidate === "string" && normalized(candidate).includes(query),
    )
  );
}

/** Presence is a read, not unique activation authority. Only explicitly owned
 * exact query matches can establish presence directly. Current native queries
 * omit ownership, so anonymous matches need the complete snapshot route that
 * preserves system-surface provenance. Misses also need that route because
 * the native query is exact while Relay's existing find permits substrings. */
export async function iosSemanticTargetPresent(input: {
  context: TargetContext;
  target: StepTarget;
  expectedAppBundleId?: string;
}): Promise<boolean | undefined> {
  const { context, target } = input;
  if (context.kind !== "device" || context.platform !== "ios" || target.identifier || target.ref)
    return undefined;
  const value = target.label ?? target.text;
  if (!value) return undefined;
  const listener = await probeLiveIosRunnerListener(context.serial);
  if (!listener) return undefined;
  const appBundleId = await rememberedTargetApplication(context);
  if (!appBundleId || (input.expectedAppBundleId && appBundleId !== input.expectedAppBundleId)) {
    throw new Error("Live XCTest presence is not bound to the recording application");
  }
  const result = await postAdoptedIosRunnerCommand(
    listener,
    {
      command: "querySelector",
      selectorKey: target.label ? "label" : "text",
      selectorValue: value,
      appBundleId,
    },
    8_000,
  );
  if ((await rememberedTargetApplication(context)) !== appBundleId) {
    throw new Error("Live XCTest presence target application changed during observation");
  }
  const nodes = result.data?.nodes ?? result.nodes ?? [];
  if (
    isIosRunnerHostProbeTree(nodes) ||
    nodes.some((node) => node.bundleId && node.bundleId !== appBundleId) ||
    (result.data?.systemSurface && result.data.systemSurface.bundleId !== appBundleId)
  ) {
    throw new Error("Live XCTest presence belongs to another application");
  }
  if (result.ok === false) {
    const code = typeof result.error === "object" ? result.error.code : undefined;
    const message = unknownErrorMessage(result.error, "Live XCTest presence query failed");
    if (code !== "AMBIGUOUS_MATCH" && !/AMBIGUOUS_MATCH|selector matched multiple/i.test(message)) {
      throw new Error(`${code ? `${code}: ` : ""}${message}`);
    }
  } else if (result.ok === true) {
    const matches = nodes.filter((node) => matchesPresenceQuery(node, value));
    if (result.data?.found !== false && matches.length > 0) {
      if (matches.some((node) => node.bundleId === appBundleId)) return true;
    } else if (result.data?.found !== false || nodes.length > 0) {
      throw new Error("Live XCTest presence query returned no authoritative match receipt");
    }
  } else {
    throw new Error("Live XCTest presence query returned no authoritative match receipt");
  }
  const current = await snapshotCompleteIosTreeForTargetApplication(context, appBundleId);
  if ((await rememberedTargetApplication(context)) !== appBundleId) {
    throw new Error("Live XCTest presence target application changed during observation");
  }
  return current.some((node) => matchesPresenceQuery(node, value));
}

import { notifyManager, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import type {
  ProductTestEditorDocument,
  TestEditorProductService,
} from "./test-editor-product-service";
import type { RunProductService, RunTargetDiscoveryScope } from "./run-product-service";
import type { ProductTargetOption } from "./target-presentation";
import { useTestRunDestinations } from "./use-test-run-destinations";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const roots: Root[] = [];
const clients: QueryClient[] = [];
afterEach(async () => {
  await act(async () => {
    for (const root of roots.splice(0)) root.unmount();
  });
  for (const client of clients.splice(0)) client.clear();
  document.body.replaceChildren();
  notifyManager.setScheduler((callback) => setTimeout(callback, 0));
  vi.useRealTimers();
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function browser(id: string): ProductTargetOption {
  return {
    targetId: id,
    kind: "browser",
    platform: "browser",
    name: id,
    detail: "Managed browser",
  };
}
function documentFor(platform?: "android" | "browser"): ProductTestEditorDocument {
  return {
    appMapId: "app",
    appName: "App",
    revision: 1,
    savedPaths: [],
    history: [],
    repairs: [],
    recordedPlatforms: platform ? [platform] : undefined,
    test: {
      id: "test",
      name: "Test",
      appMapId: "app",
      organizationId: "local",
      projectId: "default",
      kind: "scenario",
      intentSchemaVersion: 1,
      steps: [],
      createdAt: 1,
      updatedAt: 1,
    },
  };
}
function queryClient() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  clients.push(client);
  return client;
}
async function settle() {
  await act(async () => {
    if (vi.isFakeTimers()) await vi.advanceTimersByTimeAsync(0);
    else await new Promise((resolve) => setTimeout(resolve, 0));
  });
}
async function until(check: () => boolean) {
  for (let attempt = 0; attempt < 50; attempt++) {
    if (check()) return;
    await settle();
  }
  throw new Error("Destination query did not settle");
}
async function mount(props: Parameters<typeof useTestRunDestinations>[0], client = queryClient()) {
  let current!: ReturnType<typeof useTestRunDestinations>;
  function Probe(input: typeof props) {
    current = useTestRunDestinations(input);
    return null;
  }
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  const render = async (next: typeof props) => {
    await act(async () => {
      root.render(
        <QueryClientProvider client={client}>
          <Probe {...next} />
        </QueryClientProvider>,
      );
    });
    await settle();
    await settle();
  };
  await render(props);
  return { read: () => current, render };
}
function services(
  listTargets: RunProductService["listTargets"],
  get = async () => documentFor("browser"),
) {
  return {
    testId: "test",
    appMapId: "app",
    runService: { listTargets } as RunProductService,
    testEditorService: {
      get,
      edit: async () => {
        throw new Error("No edits in destination discovery");
      },
      decideRepair: async () => {
        throw new Error("No repairs in destination discovery");
      },
    } satisfies TestEditorProductService,
  };
}

it("makes a known browser ready on cold and warm setup while 60 unrelated browsers remain pending", async () => {
  vi.useFakeTimers({
    toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"],
  });
  // Keep React Query notifications immediate so the clock measures the
  // selected service response, independently of its optional 2-second list.
  notifyManager.setScheduler((callback) => queueMicrotask(callback));
  const retained = Array.from({ length: 60 }, (_, index) => browser(`unrelated-${index}`));
  const calls: RunTargetDiscoveryScope[] = [];
  const service = services(async (scope = {}) => {
    calls.push(scope);
    await new Promise((resolve) => setTimeout(resolve, scope.targetId ? 20 : 2000));
    return scope.targetId === "selected" ? [browser("selected")] : retained;
  });
  const client = queryClient();
  const coldStartedAt = Date.now();
  const cold = await mount({ ...service, selectedTargetId: "selected" }, client);
  expect(cold.read().targets.isPending).toBe(true);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(20);
  });
  await until(() => !cold.read().targets.isPending);
  expect(Date.now() - coldStartedAt).toBe(20);
  expect(cold.read().targets.isPending).toBe(false);
  expect(cold.read().targets.data?.map((target) => target.targetId)).toEqual(["selected"]);
  expect(calls).toEqual([
    { targetKind: "browser", targetId: "selected" },
    { targetKind: "browser" },
  ]);

  const warmStartedAt = Date.now();
  const warm = await mount({ ...service, selectedTargetId: "selected" }, client);
  expect(Date.now() - warmStartedAt).toBe(0);
  expect(warm.read().targets.isPending).toBe(false);
  expect(warm.read().targets.data?.map((target) => target.targetId)).toEqual(["selected"]);
  expect(calls).toHaveLength(2);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1999);
  });
  expect(cold.read().targets.data).toHaveLength(1);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1);
  });
  await until(() => cold.read().targets.data?.length === 61);
  expect(cold.read().targets.data).toHaveLength(61);
  expect(calls.every((scope) => scope.targetKind === "browser")).toBe(true);
});

it("discovers optional destinations only when run settings is opened", async () => {
  const listTargets = vi.fn(async (scope?: RunTargetDiscoveryScope) => [
    browser(scope?.targetId ?? "alternative"),
  ]);
  const props = {
    ...services(listTargets),
    selectedTargetId: "selected",
    discoverAlternatives: false,
  };
  const view = await mount(props);
  expect(listTargets).toHaveBeenCalledExactlyOnceWith({
    targetKind: "browser",
    targetId: "selected",
  });
  expect(view.read().targets.isPending).toBe(false);
  await view.render({ ...props, discoverAlternatives: true });
  await until(() => view.read().targets.data?.length === 2);
  expect(listTargets).toHaveBeenCalledWith({ targetKind: "browser" });
});

it("waits for the saved document before choosing browser or hardware discovery", async () => {
  const saved = deferred<ProductTestEditorDocument>();
  const listTargets = vi.fn(async () => [browser("unrelated")]);
  const props = services(listTargets, () => saved.promise);
  const view = await mount(props);
  expect(listTargets).not.toHaveBeenCalled();
  await act(async () => saved.resolve(documentFor("android")));
  await until(() => view.read().targets.data !== undefined);
  expect(listTargets).toHaveBeenCalledWith({ targetKind: "device" });
  expect(view.read().recordedPlatforms).toEqual(["android"]);
  expect(view.read().targets.data).toEqual([]);
});

it("checks the recorded saved-account browser first without changing the account", async () => {
  const listTargets = vi.fn(async (scope?: RunTargetDiscoveryScope) => [
    browser(scope?.targetId ?? "alternative"),
  ]);
  const props = services(listTargets);
  props.runService.listProfiles = async () => [
    {
      id: "member",
      name: "Member",
      platform: "browser",
      targetId: "member-browser",
      account: { id: "member-account", name: "Member" },
    },
  ];
  const view = await mount({ ...props, recordedProfileId: "member", lastRunTargetPending: true });
  expect(listTargets.mock.calls[0]?.[0]).toEqual({
    targetKind: "browser",
    targetId: "member-browser",
  });
  expect(view.read().profiles.data?.[0]?.account?.id).toBe("member-account");
  expect(view.read().targets.data?.some((target) => target.targetId === "member-browser")).toBe(
    true,
  );
});

it("waits for the last-used destination before falling back to the full browser inventory", async () => {
  const listTargets = vi.fn(async (scope?: RunTargetDiscoveryScope) => [
    browser(scope?.targetId ?? "alternative"),
  ]);
  const props = {
    ...services(listTargets),
    lastRunTargetPending: true,
    discoverAlternatives: false,
  };
  const view = await mount(props);
  expect(listTargets).not.toHaveBeenCalled();
  await view.render({ ...props, lastRunTargetPending: false, lastRunTargetId: "last-used" });
  expect(listTargets).toHaveBeenCalledExactlyOnceWith({
    targetKind: "browser",
    targetId: "last-used",
  });
  expect(view.read().targets.data?.[0]?.targetId).toBe("last-used");
});

it("uses the recorded browser when no account or later Run destination is known", async () => {
  const listTargets = vi.fn(async (scope?: RunTargetDiscoveryScope) => [
    browser(scope?.targetId ?? "alternative"),
  ]);
  const props = services(listTargets);
  props.runService.listProfiles = async () => [
    { id: "recorded", name: "Recorded", platform: "browser", targetId: "recorded-browser" },
  ];
  await mount({ ...props, recordedProfileId: "recorded", discoverAlternatives: false });
  expect(listTargets).toHaveBeenCalledExactlyOnceWith({
    targetKind: "browser",
    targetId: "recorded-browser",
  });
});

it("does not discover hardware or browsers for an explicitly empty route family", async () => {
  const listTargets = vi.fn(async () => []);
  const saved = documentFor();
  saved.test.family = { logicalIntentRevision: 1, bindingRevision: 1, routeVariants: [] };
  const view = await mount(services(listTargets, async () => saved));
  expect(listTargets).not.toHaveBeenCalled();
  expect(view.read().targets.data).toEqual([]);
  expect(view.read().targets.isPending).toBe(false);
});

it("does not let optional inventory override a failed exact-target readiness check", async () => {
  const selected = deferred<readonly ProductTargetOption[]>();
  const props = services(async (scope) =>
    scope?.targetId ? selected.promise : [browser("selected"), browser("replacement")],
  );
  const view = await mount({ ...props, selectedTargetId: "selected" });
  expect(view.read().targets.isPending).toBe(true);
  await act(async () => selected.reject(new Error("Selected browser is not ready")));
  await settle();
  await settle();
  expect(view.read().targets.isPending).toBe(false);
  expect(view.read().targets.data?.map((target) => target.targetId)).toEqual(["replacement"]);
  expect(view.read().targets.isError).toBe(false);
});

it("checks an explicitly switched browser instead of trusting its cached optional readiness", async () => {
  const replacement = deferred<readonly ProductTargetOption[]>();
  const props = services(async (scope) => {
    if (scope?.targetId === "replacement") return replacement.promise;
    if (scope?.targetId) return [browser("selected")];
    return [browser("selected"), browser("replacement")];
  });
  const view = await mount({ ...props, selectedTargetId: "selected" });
  await until(() => view.read().targets.data?.length === 2);
  expect(view.read().targets.data).toHaveLength(2);
  await view.render({ ...props, selectedTargetId: "replacement" });
  expect(view.read().targets.isPending).toBe(true);
  expect(view.read().targets.data).toBeUndefined();
  await act(async () => replacement.resolve([browser("replacement")]));
  await settle();
  expect(view.read().targets.isPending).toBe(false);
  expect(view.read().targets.data?.map((target) => target.targetId)).toEqual([
    "replacement",
    "selected",
  ]);
});

it("preserves all-target discovery for a legacy Test with no known platform or destination", async () => {
  const android = {
    targetId: "phone",
    kind: "device",
    platform: "android",
    name: "Phone",
    detail: "Android",
  } as const;
  const listTargets = vi.fn(async () => [browser("browser"), android]);
  const props = services(listTargets, async () => documentFor());
  const view = await mount(props);
  expect(listTargets).toHaveBeenCalledExactlyOnceWith({});
  expect(view.read().targets.data).toHaveLength(2);
});

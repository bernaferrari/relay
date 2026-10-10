import { useNavigate, useRouteContext } from "@tanstack/react-router";
import type { ProductAppOption } from "../data/recording-product-service";
import { recordingQueryKeys } from "../data/recording-queries";
import { catalogQueryKeys } from "../data/catalog-queries";
import { websiteHost, type WebsiteAccount } from "./new-test-quick-start";

/**
 * The App a website's Tests belong to: the requested one, the one remembered
 * for this host, the one its earlier runs used, a name match, or a new App.
 */
export function useWebsiteApp(
  apps: readonly ProductAppOption[] | undefined,
  requestedAppId?: string,
) {
  const { platform, catalogService, appResourcesService } = useRouteContext({ from: "__root__" });
  return async function appForWebsite(host: string, browserTargetId?: string): Promise<string> {
    if (
      requestedAppId &&
      apps?.some(
        (app) => app.id === requestedAppId && app.platform !== "android" && app.platform !== "ios",
      )
    )
      return requestedAppId;
    const key = `relay:website-app:${host}`;
    const known = new Set((apps ?? []).map((app) => app.id));
    const remembered = await Promise.resolve(platform.storage.get(key));
    if (remembered && known.has(remembered)) return remembered;
    const runs = browserTargetId ? await catalogService.listRuns().catch(() => []) : [];
    const fromRuns = runs.find(
      (run) =>
        Boolean(browserTargetId) &&
        run.executionIdentity?.deviceId === browserTargetId &&
        known.has(run.executionIdentity?.appMapId ?? ""),
    )?.executionIdentity?.appMapId;
    const bare = host.replace(/^www\./, "").toLowerCase();
    const named = apps?.find((app) => app.name.toLowerCase().includes(bare))?.id;
    const appId = fromRuns ?? named ?? (await appResourcesService.createApp(bare)).id;
    await Promise.resolve(platform.storage.set(key, appId));
    return appId;
  };
}

/**
 * "What should work?" → a saved plain-English Test. Relay drafts Action and
 * Check steps (with a model when configured, otherwise line by line), saves
 * them with the website as the start address, and opens the Test to run.
 */
export function useDescribeWebsiteTest({
  appForWebsite,
  setProgress,
  setError,
}: {
  appForWebsite(host: string): Promise<string>;
  setProgress(value: string | undefined): void;
  setError(value: string | undefined): void;
}) {
  const { testEditorService, queryClient, platform } = useRouteContext({ from: "__root__" });
  const navigate = useNavigate();
  return async function describeWebsiteTest(goal: string, url: string, account?: WebsiteAccount) {
    const host = websiteHost(url);
    setError(undefined);
    try {
      if (!testEditorService.draftSteps || !testEditorService.createDraft) {
        throw new Error("This Relay version cannot write steps yet.");
      }
      // A pasted test file is saved exactly as written.
      if (/^\s*name:|\n\s*steps:/u.test(goal) && testEditorService.applyYaml) {
        setProgress("Saving test…");
        const yaml = /\n\s*(?:url|app):/u.test(`\n${goal}`) ? goal : `${goal}\nurl: ${url}\n`;
        const applied = await testEditorService.applyYaml(yaml);
        await queryClient.invalidateQueries({ queryKey: catalogQueryKeys.tests });
        await navigate({ to: "/tests/$testId/edit", params: { testId: applied.testId } });
        return;
      }
      setProgress("Writing steps…");
      const appMapId = await appForWebsite(host);
      // The run uses the same login people chose here.
      await Promise.resolve(
        platform.storage.set(`relay:website-account:${host}`, account?.reference ?? ""),
      );
      const drafted = await testEditorService.draftSteps({ appMapId, goal, startUrl: url });
      if (!drafted.steps.length) throw new Error("Describe at least one thing to do or check.");
      setProgress("Saving test…");
      const document = await testEditorService.createDraft({
        appMapId,
        testId: `test-${crypto.randomUUID()}`,
        name: drafted.name,
        steps: drafted.steps,
        startUrl: url,
      });
      await queryClient.invalidateQueries({ queryKey: catalogQueryKeys.tests });
      await queryClient.invalidateQueries({ queryKey: recordingQueryKeys.apps });
      await navigate({ to: "/tests/$testId/edit", params: { testId: document.test.id } });
    } catch (error) {
      setError(
        error instanceof Error && error.message
          ? `Relay could not create the test: ${error.message}`
          : "Relay could not create the test. Try again.",
      );
    } finally {
      setProgress(undefined);
    }
  };
}

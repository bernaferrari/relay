/** @jsxImportSource react */
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, useRouteContext } from "@tanstack/react-router";
import { Globe, Check } from "lucide-react";
import { Button } from "@relay/ui-react/components/button";
import { BrowserAddressBar } from "../components/browser-address-bar";
import type { LiveTargetSession, LiveTargetSnapshot } from "../data/live-target-session";
import { LiveTargetCanvas } from "./live-target-canvas";
import { errorMessage } from "./recording-shared";
import {
  accountDisplayName,
  accountStatus,
  accountsForBrowser,
  runUsesAccount,
} from "./account-presentation";
import { websiteHost } from "./new-test-quick-start";

/** A saved Test can inspect its real browser without inventing a recording session. */
export function TestEditorBrowserPane({
  appMapId,
  startUrl,
  browserTargetIds = [],
  recentAccountIds = [],
}: {
  appMapId: string;
  startUrl?: string;
  browserTargetIds?: readonly string[];
  /** Accounts this Test ran as, newest first; the first one saved here is the default. */
  recentAccountIds?: readonly string[];
}) {
  const { browserSpacesService, appResourcesService, productService, platform } = useRouteContext({
    from: "__root__",
  });
  const spaces = useQuery({
    queryKey: ["test-editor", "browser-spaces"],
    queryFn: () => browserSpacesService.listSpaces(),
  });
  const accounts = useQuery({
    queryKey: ["app-resources", "browser-accounts"],
    queryFn: () => appResourcesService.listBrowserAccounts(),
    staleTime: 10_000,
  });
  const [chosenSpaceId, setSpaceId] = useState("");
  const [choosingWebsite, setChoosingWebsite] = useState(false);
  const recommended = (spaces.data ?? []).filter(
    (item) => item.startUrl.replace(/\/$/, "") === startUrl?.replace(/\/$/, ""),
  );
  const associated = (spaces.data ?? []).filter((item) => browserTargetIds.includes(item.id));
  const spaceId =
    chosenSpaceId ||
    (recommended.length === 1
      ? recommended[0]!.id
      : associated.length === 1
        ? associated[0]!.id
        : "");
  /** undefined: use the account the Test was recorded with; "": Guest. */
  const [chosenAccount, setChosenAccount] = useState<string>();
  const [session, setSession] = useState<LiveTargetSession>();
  const sessionRef = useRef<LiveTargetSession | undefined>(undefined);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [snapshot, setSnapshot] = useState<LiveTargetSnapshot>();
  const [issue, setIssue] = useState<string>();
  const [busy, setBusy] = useState(false);
  const inputQueue = useRef<Promise<unknown>>(Promise.resolve());
  const mounted = useRef(true);
  const space = spaces.data?.find((item) => item.id === spaceId);
  const spaceAccounts = accountsForBrowser(accounts.data ?? [], spaceId);
  const siteHost = space ? websiteHost(space.startUrl) : "";
  // The login last chosen for this website when a Test was recorded here.
  const rememberedAccount = useQuery({
    queryKey: ["test-editor", "remembered-account", siteHost],
    queryFn: async () =>
      (await Promise.resolve(platform.storage.get(`relay:website-account:${siteHost}`))) ?? "",
    enabled: Boolean(siteHost),
  });
  const recordedAccount =
    recentAccountIds
      .map((id) =>
        spaceAccounts.find((account) =>
          runUsesAccount({ executionIdentity: { accountId: id } }, account.fixture),
        ),
      )
      .find(Boolean) ??
    spaceAccounts.find((account) => account.fixture.reference === rememberedAccount.data);
  const accountReference = chosenAccount ?? recordedAccount?.fixture.reference ?? "";
  const open = useMutation({
    mutationFn: async () => {
      if (!space || !productService.previewTarget)
        throw new Error("Choose an available browser first.");
      const account = spaceAccounts.find((item) => item.fixture.reference === accountReference);
      if (accountReference && !account)
        throw new Error("This account is unavailable. Choose another account.");
      return productService.previewTarget(
        { kind: "browser", platform: "browser", targetId: space.id },
        account ? { authenticationFixtureId: account.fixture.reference } : { signedOut: true },
      );
    },
    onSuccess: (next) => {
      if (!mounted.current) return next.close();
      sessionRef.current?.close();
      sessionRef.current = next;
      setSession(next);
      setSnapshot(next.snapshot());
      setIssue(undefined);
    },
  });
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      sessionRef.current?.close();
    };
  }, []);
  useEffect(() => {
    if (!session || !canvas.current) return;
    const unsubscribe = session.subscribe((next) =>
      setSnapshot((current) =>
        current?.status === next.status &&
        current.issue === next.issue &&
        current.browserContext === next.browserContext
          ? current
          : next,
      ),
    );
    const unmount = session.mount(canvas.current);
    return () => {
      unsubscribe();
      unmount();
    };
  }, [session]);
  function disconnect() {
    sessionRef.current?.close();
    sessionRef.current = undefined;
    setSession(undefined);
    setSnapshot(undefined);
    setIssue(undefined);
    open.reset();
  }
  async function send(input: Parameters<LiveTargetSession["input"]>[0]) {
    if (!session) return false;
    setBusy(true);
    setIssue(undefined);
    try {
      const pending = inputQueue.current.then(() => session.input(input));
      inputQueue.current = pending.catch(() => undefined);
      await pending;
      return true;
    } catch (error) {
      setIssue(
        error instanceof Error &&
          /browser changed|Browser Device|browser tab|browser page/i.test(error.message)
          ? "The page changed before the click arrived. Check the updated view and click again."
          : errorMessage(error),
      );
      return false;
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background"
      aria-label="Test browser"
    >
      {!session ? (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 overflow-auto px-6 py-5">
            <h3 className="text-base font-medium">Open website</h3>
            <p className="mt-1 text-sm text-muted-foreground">Browse and test your website here.</p>
            {space && !choosingWebsite ? (
              <div className="mt-6 flex items-center gap-3 rounded-xl border border-border p-4">
                <Globe className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{space.name}</p>
                  <p className="truncate text-xs text-muted-foreground">{space.startUrl}</p>
                </div>
                <Button variant="ghost" size="sm" onClick={() => setChoosingWebsite(true)}>
                  Change website
                </Button>
              </div>
            ) : (
              <div
                className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2"
                role="group"
                aria-label="Websites"
              >
                {(spaces.data ?? []).map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    aria-pressed={spaceId === item.id}
                    disabled={open.isPending}
                    onClick={() => {
                      setSpaceId(item.id);
                      setChoosingWebsite(false);
                      setChosenAccount(undefined);
                      open.reset();
                    }}
                    className="group min-w-0 rounded-xl border border-border p-4 text-left transition-colors hover:bg-muted/50 aria-pressed:border-primary aria-pressed:bg-primary/5 focus-visible:outline-2 focus-visible:outline-ring"
                  >
                    <div className="mb-4 flex items-center justify-between">
                      <Globe className="size-5 text-muted-foreground" aria-hidden="true" />
                      {spaceId === item.id ? (
                        <Check className="size-4 text-primary" aria-hidden="true" />
                      ) : null}
                    </div>
                    <span className="block truncate text-sm font-medium">{item.name}</span>
                    <span className="mt-1 block truncate text-xs text-muted-foreground">
                      {item.startUrl}
                    </span>
                    {item.viewport ? (
                      <span className="mt-3 block text-xs text-muted-foreground">
                        {item.viewport.width} × {item.viewport.height}
                      </span>
                    ) : null}
                  </button>
                ))}
              </div>
            )}
            {spaces.isPending ? (
              <p className="mt-4 text-sm text-muted-foreground">Loading browsers…</p>
            ) : null}
          </div>
          <div className="grid shrink-0 gap-3 border-t border-border bg-background px-6 py-4">
            {spaceId ? (
              <label className="grid min-w-0 gap-1.5 text-xs text-muted-foreground">
                Account
                <select
                  aria-label="Account"
                  value={accountReference}
                  disabled={open.isPending || accounts.isPending}
                  className="h-9 min-w-0 rounded-lg border border-border bg-background px-3 text-sm text-foreground focus-visible:outline-2 focus-visible:outline-ring"
                  onChange={(event) => setChosenAccount(event.target.value)}
                >
                  <option value="">Guest · not signed in</option>
                  {spaceAccounts.map((account) => (
                    <option key={account.fixture.reference} value={account.fixture.reference}>
                      {accountDisplayName(account)}
                      {account === recordedAccount ? " · recorded with" : ""}
                      {accountStatus(account) === "signed-in" ? "" : " · needs sign-in"}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <Button
              className="w-fit"
              disabled={!space || open.isPending}
              onClick={() => open.mutate()}
            >
              {open.isPending ? "Opening…" : "Open browser"}
            </Button>
            {spaces.error || accounts.error || open.error ? (
              <p role="alert" className="text-sm text-destructive">
                {errorMessage(spaces.error ?? accounts.error ?? open.error)}
              </p>
            ) : null}
          </div>
        </div>
      ) : (
        <>
          <BrowserAddressBar
            url={snapshot?.browserContext?.pageUrl}
            disabled={busy || snapshot?.status !== "streaming"}
            send={send}
            trailing={
              <Button type="button" size="sm" variant="ghost" onClick={disconnect} disabled={busy}>
                Change
              </Button>
            }
          />
          <div className="min-h-64 flex-1">
            <LiveTargetCanvas
              canvasRef={canvas}
              status={snapshot?.status ?? "connecting"}
              issue={issue ?? snapshot?.issue}
              busy={busy}
              targetTitle={space?.name ?? "Browser"}
              targetDetail=""
              browserContext={snapshot?.browserContext}
              send={send}
              recording={false}
              directBrowser
              showTargetDetails={false}
              helpText=""
              recoveryAction={
                <Button onClick={() => open.mutate()} disabled={open.isPending}>
                  Reconnect
                </Button>
              }
            />
          </div>
          <div className="flex items-center justify-between gap-3 border-t border-border px-4 py-3">
            <p className="text-xs text-muted-foreground">Click and type directly in the browser.</p>
            <Button
              size="sm"
              variant="outline"
              nativeButton={false}
              render={<Link to="/tests/new" search={{ app: appMapId, target: spaceId }} />}
            >
              New recording
            </Button>
          </div>
        </>
      )}
    </section>
  );
}

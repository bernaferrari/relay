import { For, Show, createSignal } from "solid-js";
import { Button } from "@relay/ui/button";
import { IconButton } from "@relay/ui/icon-button";
import { useServer } from "../../context/server";
import { Icon } from "../icon";
import { EmptyState } from "../empty-state";
import { cn } from "../../lib/cn";
import { humanError } from "../../lib/human-error";
import { copyDescription, copyStack, copyTitle } from "../../lib/ui";
import { inputCls, rowDescCls, rowTitleCls } from "./settings-styles";
import type { BrowserAuthenticationFixture } from "@relay/protocol";
import { confirmAction } from "../confirm-dialog";

export function TargetsSettingsPanel() {
  const server = useServer();
  const [targetName, setTargetName] = createSignal("Chat app");
  const [targetUrl, setTargetUrl] = createSignal("");
  const [targetBusy, setTargetBusy] = createSignal(false);
  const [openingTargetId, setOpeningTargetId] = createSignal<string | null>(null);
  const [targetError, setTargetError] = createSignal("");
  const [authenticationTargetId, setAuthenticationTargetId] = createSignal<string | null>(null);
  const [authenticationName, setAuthenticationName] = createSignal("");
  const [authenticationBusy, setAuthenticationBusy] = createSignal(false);
  const [authenticationError, setAuthenticationError] = createSignal("");
  const [authenticationFixtures, setAuthenticationFixtures] = createSignal<
    Record<string, BrowserAuthenticationFixture[]>
  >({});
  const [preflight, setPreflight] = createSignal<{
    id: string;
    ok: boolean;
    message: string;
  } | null>(null);

  async function createBrowserTarget(event: SubmitEvent) {
    event.preventDefault();
    setTargetError("");
    setTargetBusy(true);
    try {
      await server.saveBrowserTarget({
        name: targetName().trim(),
        startUrl: targetUrl().trim(),
        headless: false,
      });
      setTargetUrl("");
    } catch (error) {
      setTargetError(humanError(error, "Could not save this browser target."));
    } finally {
      setTargetBusy(false);
    }
  }

  async function checkTarget(id: string) {
    setPreflight({ id, ok: false, message: "Checking browser and isolated profile…" });
    try {
      const result = await server.preflightTarget(id);
      setPreflight({
        id,
        ok: result.ok,
        message: result.checks.map((check) => check.message).join(" · "),
      });
    } catch (error) {
      setPreflight({
        id,
        ok: false,
        message: humanError(error, "Could not check this target’s setup."),
      });
    }
  }

  async function openTarget(id: string) {
    setTargetError("");
    setOpeningTargetId(id);
    try {
      await server.openBrowserTarget(id);
    } catch (error) {
      setTargetError(humanError(error, "Could not open this browser target."));
    } finally {
      setOpeningTargetId(null);
    }
  }

  async function loadAuthenticationFixtures(targetId: string) {
    const result = await server.runAction("target.browser-auth.list", { targetId });
    setAuthenticationFixtures((current) => ({ ...current, [targetId]: result.fixtures }));
  }

  async function editAuthentication(target: { id: string; name: string }) {
    setAuthenticationError("");
    setAuthenticationTargetId(target.id);
    setAuthenticationName(`${target.name} sign-in`);
    try {
      await loadAuthenticationFixtures(target.id);
    } catch (error) {
      setAuthenticationError(humanError(error, "Could not load saved sign-in states."));
    }
  }

  async function saveAuthentication(event: SubmitEvent, targetId: string) {
    event.preventDefault();
    setAuthenticationError("");
    setAuthenticationBusy(true);
    try {
      await server.runAction("target.browser-auth.save", {
        targetId,
        name: authenticationName().trim(),
        confirm: true,
      });
      await Promise.all([loadAuthenticationFixtures(targetId), server.refreshTargets()]);
      setAuthenticationTargetId(null);
    } catch (error) {
      setAuthenticationError(
        humanError(
          error,
          "Could not save this sign-in state. Open the browser, finish signing in, then try again.",
        ),
      );
    } finally {
      setAuthenticationBusy(false);
    }
  }

  async function revokeAuthenticationNow(targetId: string, reference: string) {
    setAuthenticationError("");
    setAuthenticationBusy(true);
    try {
      await server.runAction("target.browser-auth.revoke", {
        targetId,
        reference,
        confirm: true,
      });
      await Promise.all([loadAuthenticationFixtures(targetId), server.refreshTargets()]);
    } catch (error) {
      setAuthenticationError(humanError(error, "Could not revoke this sign-in state."));
    } finally {
      setAuthenticationBusy(false);
    }
  }

  function revokeAuthentication(targetId: string, fixture: BrowserAuthenticationFixture) {
    confirmAction({
      title: `Revoke ${fixture.name}?`,
      body: "This exact sign-in revision will stop working immediately. Future Proof runs that still reference it will stop for review.",
      confirmLabel: "Revoke sign-in state",
      tone: "destructive",
      onConfirm: () => revokeAuthenticationNow(targetId, fixture.reference),
    });
  }

  return (
    <>
      <div class="mb-4">
        <h3 class="m-0 text-body font-medium text-text-strong">Browser targets</h3>
        <p class="mt-1 mb-0 text-caption leading-relaxed text-text-weak">
          Give each website a private browser. Open it inside Relay, then record and replay the same
          tests you use on iOS and Android.
        </p>
      </div>

      <form class="flex flex-col gap-3" onSubmit={createBrowserTarget}>
        <label class="flex flex-col gap-1.5">
          <span class={rowTitleCls}>Name</span>
          <input
            class={inputCls}
            name="target-name"
            autocomplete="off"
            value={targetName()}
            onInput={(event) => setTargetName(event.currentTarget.value)}
            required
          />
        </label>
        <label class="flex flex-col gap-1.5">
          <span class={rowTitleCls}>Start URL</span>
          <input
            class={inputCls}
            name="target-url"
            type="url"
            inputmode="url"
            autocomplete="url"
            spellcheck={false}
            placeholder="https://chat.example.com"
            value={targetUrl()}
            onInput={(event) => setTargetUrl(event.currentTarget.value)}
            aria-describedby="target-url-help"
            required
          />
          <span id="target-url-help" class={rowDescCls}>
            Relay opens this page in a dedicated profile for recording and replay.
          </span>
        </label>
        <Show when={targetError()}>
          <p class="m-0 text-caption text-icon-critical-base" role="alert">
            {targetError()}
          </p>
        </Show>
        <div>
          <Button variant="primary" size="sm" type="submit" disabled={targetBusy()}>
            {targetBusy() ? "Adding…" : "Add browser target"}
          </Button>
        </div>
      </form>

      <div class="mt-5 flex flex-col gap-2 border-t border-border-weak-base pt-4">
        <Show
          when={server.targets().length > 0}
          fallback={
            <EmptyState
              size="sm"
              align="start"
              icon="server"
              title="No browser targets yet"
              description="Add a site above to record and replay web tests."
              class="px-0"
            />
          }
        >
          <For each={server.targets()}>
            {(target) => (
              <div class="rounded-lg border border-border-weak-base bg-background-base p-3">
                <div class="flex items-start justify-between gap-3">
                  <div class={copyStack}>
                    <strong class={`block truncate text-caption font-medium ${copyTitle}`}>
                      {target.name}
                    </strong>
                    <span class={`block truncate text-caption ${copyDescription}`}>
                      {target.browser?.startUrl}
                    </span>
                  </div>
                  <div class="flex shrink-0 gap-1.5">
                    <Button
                      variant="primary"
                      size="sm"
                      disabled={openingTargetId() === target.id}
                      onClick={() => void openTarget(target.id)}
                    >
                      {openingTargetId() === target.id ? "Opening…" : "Open in Relay"}
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => void checkTarget(target.id)}>
                      Check setup
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-expanded={authenticationTargetId() === target.id}
                      onClick={() =>
                        authenticationTargetId() === target.id
                          ? setAuthenticationTargetId(null)
                          : void editAuthentication(target)
                      }
                    >
                      Sign-in state
                    </Button>
                    <IconButton
                      variant="ghost"
                      size="normal"
                      aria-label={`Delete ${target.name}`}
                      onClick={() => void server.deleteTarget(target.id)}
                    >
                      <Icon name="trash" size={14} />
                    </IconButton>
                  </div>
                </div>
                <Show when={preflight()?.id === target.id}>
                  <p
                    class={cn(
                      "mt-2 mb-0 text-caption leading-relaxed",
                      preflight()?.ok ? "text-icon-success-base" : "text-text-weak",
                    )}
                    role="status"
                  >
                    {preflight()?.message}
                  </p>
                </Show>
                <Show when={authenticationTargetId() === target.id}>
                  <div class="mt-3 grid gap-3 border-t border-border-weak-base pt-3">
                    <div class="grid gap-1">
                      <strong class={rowTitleCls}>Use a reviewed signed-in browser</strong>
                      <p class={`m-0 max-w-[65ch] ${rowDescCls}`}>
                        Open this target, finish sign-in or MFA, and verify the account. Relay
                        encrypts the browser state locally; cookies and tokens never appear in
                        Proofs or evidence.
                      </p>
                    </div>
                    <form
                      class="flex flex-wrap items-end gap-2"
                      onSubmit={(event) => void saveAuthentication(event, target.id)}
                    >
                      <label class="grid min-w-56 flex-1 gap-1.5">
                        <span class={rowTitleCls}>Sign-in name</span>
                        <input
                          class={inputCls}
                          autocomplete="off"
                          spellcheck={false}
                          value={authenticationName()}
                          onInput={(event) => setAuthenticationName(event.currentTarget.value)}
                          required
                        />
                      </label>
                      <Button
                        variant="primary"
                        size="sm"
                        type="submit"
                        disabled={authenticationBusy() || !authenticationName().trim()}
                      >
                        {authenticationBusy() ? "Encrypting…" : "Save reviewed state"}
                      </Button>
                    </form>
                    <Show when={authenticationError()}>
                      <p class="m-0 text-caption text-icon-critical-base" role="alert">
                        {authenticationError()}
                      </p>
                    </Show>
                    <For
                      each={(authenticationFixtures()[target.id] ?? []).filter(
                        (fixture) => fixture.revokedAt === undefined,
                      )}
                    >
                      {(fixture) => (
                        <div class="flex items-center justify-between gap-3 rounded-md bg-background-weak px-3 py-2">
                          <div class="min-w-0">
                            <span class="block truncate text-caption font-medium text-text-strong">
                              {fixture.name}
                            </span>
                            <span class="block text-caption text-text-weak">
                              {fixture.cookieCount} encrypted cookie
                              {fixture.cookieCount === 1 ? "" : "s"} · revision {fixture.revision}
                            </span>
                          </div>
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={authenticationBusy()}
                            onClick={() => revokeAuthentication(target.id, fixture)}
                          >
                            Revoke
                          </Button>
                        </div>
                      )}
                    </For>
                  </div>
                </Show>
              </div>
            )}
          </For>
        </Show>
      </div>
    </>
  );
}

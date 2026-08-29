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

export function TargetsSettingsPanel() {
  const server = useServer();
  const [targetName, setTargetName] = createSignal("Chat app");
  const [targetUrl, setTargetUrl] = createSignal("");
  const [targetBusy, setTargetBusy] = createSignal(false);
  const [openingTargetId, setOpeningTargetId] = createSignal<string | null>(null);
  const [targetError, setTargetError] = createSignal("");
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
              </div>
            )}
          </For>
        </Show>
      </div>
    </>
  );
}

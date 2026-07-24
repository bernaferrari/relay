import { Show, createSignal } from "solid-js";
import { useServer } from "../context/server";
import { cn } from "../lib/cn";
import { presentTarget } from "../lib/target-presentation";
import { Icon } from "./icon";

type PromptProps = {
  onDescribe: (description: string) => void;
};

function TestPrompt(props: PromptProps) {
  const [description, setDescription] = createSignal("");
  const submit = () => {
    const value = description().trim();
    if (value) props.onDescribe(value);
  };

  return (
    <div class="group/prompt grid gap-2 rounded-[15px] border border-[var(--v2-border-border-muted)] bg-[var(--v2-background-bg-base)] p-2.5 transition-[border-color,box-shadow] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] focus-within:border-[var(--text-interactive-base)] focus-within:shadow-[0_0_0_3px_color-mix(in_srgb,var(--v2-background-bg-accent)_14%,transparent)]">
      <div class="flex items-center gap-1.5 px-1 pt-0.5 text-[11.5px] font-medium text-[var(--text-weak)]">
        <Icon name="sparkle" size={12} class="text-[var(--text-interactive-base)]" />
        Describe it
      </div>
      <textarea
        data-new-test-prompt
        class="min-h-[58px] w-full resize-none bg-transparent px-1 text-[13px]/[1.55] text-[var(--text-strong)] outline-none placeholder:text-[var(--text-weak)] placeholder:italic"
        rows={2}
        value={description()}
        placeholder="Sign in, open the profile, and check the account name is correct"
        onInput={(event) => setDescription(event.currentTarget.value)}
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key === "Enter") submit();
        }}
      />
      <div class="flex items-center justify-between gap-2 px-1 pb-0.5">
        <span class="inline-flex items-center gap-1.5 text-[10.5px] text-[var(--text-weak)]">
          <kbd class="inline-grid h-[19px] min-w-[19px] place-items-center rounded-[6px] border border-[var(--v2-border-border-muted)] bg-[var(--v2-background-bg-deep)] px-1 text-[11px] leading-none font-medium text-[var(--text-base)]">
            ⌘
          </kbd>
          <kbd class="inline-grid h-[19px] min-w-[19px] place-items-center rounded-[6px] border border-[var(--v2-border-border-muted)] bg-[var(--v2-background-bg-deep)] px-1 text-[10px] leading-none font-medium text-[var(--text-base)]">
            ↵
          </kbd>
          to create
        </span>
        <button
          type="button"
          class="group/create inline-flex h-8 items-center gap-1.5 rounded-[9px] bg-[var(--product-accent-soft)] pr-2.5 pl-3 text-[12px] font-semibold text-[var(--text-interactive-base)] transition-[background-color,color,opacity,transform] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] hover:enabled:brightness-[0.97] active:enabled:scale-[0.97] disabled:opacity-40"
          disabled={!description().trim()}
          onClick={submit}
        >
          Create
          <Icon
            name="arrow-right"
            size={13}
            class="transition-transform duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] group-hover/create:enabled:translate-x-0.5"
          />
        </button>
      </div>
    </div>
  );
}

export function TestWelcome(props: {
  onDescribe: (description: string) => void;
  onRecord: () => void;
  onOpenTargets: () => void;
}) {
  const server = useServer();
  const target = () =>
    server.devices().find((device) => device.serial === server.selectedDevice()) ?? null;
  const targetCopy = () => (target() ? presentTarget(target()!) : null);
  const targetReady = () =>
    Boolean(target()) && server.health() === "online" && target()!.booted !== false;

  return (
    <section
      class="col-span-full flex min-h-0 flex-1 flex-col overflow-y-auto px-6 py-10"
      aria-labelledby="test-welcome-title"
    >
      <div class="my-auto grid w-[min(100%,452px)] gap-5 self-center">
        <header class="text-center">
          <h2
            id="test-welcome-title"
            class="text-[23px] font-semibold tracking-[-0.035em] text-[var(--text-strong)]"
          >
            Show Relay what to test
          </h2>
          <p class="mx-auto mt-1.5 max-w-[368px] text-[12.5px]/[1.55] text-[var(--text-base)]">
            Record the flow on your device, or describe it in a sentence.
          </p>
        </header>

        {/* Primary — record on device */}
        <button
          type="button"
          class={cn(
            "group/rec relative grid w-full grid-cols-[46px_minmax(0,1fr)_38px] items-center gap-3.5 rounded-[18px] p-4 text-left",
            "border transition-[background-color,border-color,box-shadow,transform] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)]",
            "active:scale-[0.99]",
            targetReady()
              ? "border-transparent bg-gradient-to-b from-[#7c6cf6] to-[#6957ee] shadow-[0_10px_28px_-10px_rgb(89_69_214/55%)] hover:shadow-[0_14px_34px_-10px_rgb(89_69_214/60%)]"
              : "border-[var(--v2-border-border-strong)] bg-surface-raised-stronger-non-alpha shadow-xs-border-base hover:border-[var(--text-interactive-base)]",
          )}
          onClick={() => (targetReady() ? props.onRecord() : props.onOpenTargets())}
        >
          <span
            class={cn(
              "grid size-[46px] place-items-center rounded-[13px]",
              targetReady()
                ? "bg-white/15 text-white"
                : "bg-[var(--product-accent-soft)] text-[var(--text-interactive-base)]",
            )}
          >
            <Show when={target()} fallback={<Icon name="smartphone" size={21} />}>
              <Icon name={target()!.platform === "browser" ? "server" : "smartphone"} size={21} />
            </Show>
          </span>

          <span class="min-w-0 text-left">
            <strong
              class={cn(
                "block truncate text-[14.5px] font-semibold tracking-[-0.015em]",
                targetReady() ? "text-white" : "text-[var(--text-strong)]",
              )}
            >
              {targetReady() ? `Record on ${targetCopy()!.displayName}` : "Record from device"}
            </strong>
            <small
              class={cn(
                "mt-0.5 flex items-center justify-start gap-1.5 truncate text-left text-[11.5px]/[1.4]",
                targetReady() ? "text-white/75" : "text-[var(--text-weak)]",
              )}
            >
              <Show when={!targetReady()}>
                <i class="size-1.5 shrink-0 rounded-full bg-[var(--icon-warning-base)]" />
              </Show>
              {targetReady()
                ? "Use the app normally; every tap becomes a step."
                : target()
                  ? "Boot the device, then start recording."
                  : "Pick a simulator, phone, or browser to record on."}
            </small>
          </span>

          <span
            class={cn(
              "grid size-[34px] place-items-center rounded-full transition-transform duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] group-hover/rec:translate-x-0.5",
              targetReady()
                ? "bg-white/18 text-white"
                : "bg-[var(--v2-background-bg-layer-01)] text-[var(--text-base)]",
            )}
          >
            <Icon name="arrow-right" size={16} />
          </span>
        </button>

        <div class="flex items-center gap-3 text-[10px] font-semibold tracking-[0.12em] text-[var(--text-weak)]">
          <span class="h-px flex-1 bg-[var(--v2-border-border-muted)]" />
          OR
          <span class="h-px flex-1 bg-[var(--v2-border-border-muted)]" />
        </div>

        {/* Secondary — describe it */}
        <TestPrompt onDescribe={props.onDescribe} />
      </div>
    </section>
  );
}

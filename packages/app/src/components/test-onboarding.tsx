import { Show, createSignal } from "solid-js";
import { useServer } from "../context/server";
import { cn } from "../lib/cn";
import { presentTarget } from "../lib/target-presentation";
import { eyebrow, modalPanel, modalScrim, productIconButton, productPrimary } from "../lib/ui";
import { shellRecordDot } from "../lib/shell-layout";
import { Icon } from "./icon";

type PromptProps = {
  autofocus?: boolean;
  onDescribe: (description: string) => void;
};

function TestPrompt(props: PromptProps) {
  const [description, setDescription] = createSignal("");
  const submit = () => {
    const value = description().trim();
    if (value) props.onDescribe(value);
  };

  return (
    <div class="grid gap-2.5">
      <label class="grid gap-2">
        <span class="text-[11px] font-medium text-[var(--text-base)]">Describe the journey</span>
        <textarea
          class="min-h-[104px] w-full resize-y rounded-[12px] border border-[var(--v2-border-border-strong)] bg-[var(--v2-background-bg-deep)] px-3.5 py-3 text-[13px]/[1.5] text-[var(--text-strong)] outline-none transition-[border-color,box-shadow] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] placeholder:text-[var(--text-weak)] focus:border-[var(--text-interactive-base)] focus:shadow-[0_0_0_3px_color-mix(in_srgb,var(--v2-background-bg-accent)_15%,transparent)]"
          autofocus={props.autofocus}
          rows={4}
          value={description()}
          placeholder="Sign in, open the profile, and check that the account name is correct"
          onInput={(event) => setDescription(event.currentTarget.value)}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === "Enter") submit();
          }}
        />
      </label>
      <div class="flex items-center justify-between gap-3">
        <small class="text-[10.5px] text-[var(--text-weak)]">⌘ Enter</small>
        <button
          type="button"
          class={cn(productPrimary, "active:scale-[0.97]")}
          disabled={!description().trim()}
          onClick={submit}
        >
          <Icon name="sparkle" size={14} /> Create test
        </button>
      </div>
    </div>
  );
}

export function NewTestDialog(props: {
  onClose: () => void;
  onDescribe: (description: string) => void;
  onRecord: () => void;
}) {
  return (
    <div class={cn(modalScrim, "z-[120] flex items-center justify-center p-5")}>
      <section
        class={cn(modalPanel, "grid w-[min(100%,460px)] gap-4 p-4")}
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-test-title"
      >
        <header class="flex items-start justify-between gap-3">
          <div>
            <span class={eyebrow}>New test</span>
            <h2
              id="new-test-title"
              class="mt-1 text-[18px] font-semibold text-[var(--text-strong)]"
            >
              What should happen?
            </h2>
          </div>
          <button
            type="button"
            class={productIconButton}
            aria-label="Close"
            onClick={props.onClose}
          >
            <Icon name="x" size={15} />
          </button>
        </header>
        <TestPrompt autofocus onDescribe={props.onDescribe} />
        <RecordChoice onRecord={props.onRecord} />
      </section>
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
      class="col-span-full min-h-0 flex-1 overflow-y-auto px-6 py-10"
      aria-labelledby="test-welcome-title"
    >
      <div class="mx-auto grid w-[min(100%,520px)] gap-5">
        <header class="text-center">
          <span class="mx-auto grid size-10 place-items-center rounded-[11px] bg-[var(--product-accent-soft)] text-[var(--text-interactive-base)]">
            <Icon name="sparkle" size={18} />
          </span>
          <h2
            id="test-welcome-title"
            class="mt-3 text-[22px] font-semibold tracking-[-0.035em] text-[var(--text-strong)]"
          >
            Create a test in seconds
          </h2>
          <p class="mx-auto mt-1.5 max-w-[430px] text-[12.5px]/[1.55] text-[var(--text-base)]">
            Say what a customer should do. Relay turns it into editable steps you can run on a phone
            or browser.
          </p>
        </header>

        <div class="rounded-[16px] border border-[var(--v2-border-border-muted)] bg-surface-raised-stronger-non-alpha p-4 shadow-[0_18px_50px_rgb(0_0_0/18%)]">
          <TestPrompt autofocus onDescribe={props.onDescribe} />
        </div>

        <div class="flex items-center gap-3 text-[10px] text-[var(--text-weak)]">
          <span class="h-px flex-1 bg-[var(--v2-border-border-muted)]" /> or record the real journey
          <span class="h-px flex-1 bg-[var(--v2-border-border-muted)]" />
        </div>

        <button
          type="button"
          class="grid min-h-[66px] w-full grid-cols-[36px_minmax(0,1fr)_auto] items-center gap-3 rounded-[13px] border border-[var(--v2-border-border-muted)] bg-[var(--v2-background-bg-base)] px-3.5 text-left transition-[background-color,transform] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] hover:bg-[var(--v2-background-bg-layer-01)] active:scale-[0.985]"
          onClick={() => (targetReady() ? props.onRecord() : props.onOpenTargets())}
        >
          <span class="grid size-9 place-items-center rounded-[10px] bg-[var(--product-accent-soft)] text-[var(--text-interactive-base)]">
            <Show when={target()} fallback={<Icon name="smartphone" size={16} />}>
              <Icon name={target()!.platform === "browser" ? "server" : "smartphone"} size={16} />
            </Show>
          </span>
          <span class="min-w-0">
            <strong class="block text-[12.5px] font-semibold text-[var(--text-strong)]">
              {targetReady() ? `Record on ${targetCopy()!.displayName}` : "Choose a test target"}
            </strong>
            <small class="mt-0.5 block text-[10.5px] text-[var(--text-weak)]">
              {targetReady()
                ? "Use the app normally; every interaction becomes a step."
                : target()
                  ? "This target needs to be started before recording."
                  : "Choose a simulator, phone, or browser to record."}
            </small>
          </span>
          <span class="inline-flex items-center gap-1.5 text-[11px] font-medium text-[var(--text-base)]">
            <i
              class={cn(
                "size-1.5 rounded-full",
                targetReady() ? "bg-[var(--icon-success-base)]" : "bg-[var(--icon-warning-base)]",
              )}
            />
            {targetReady() ? "Record" : "Set up"}
            <Icon name="arrow-right" size={13} />
          </span>
        </button>

        <p class="m-0 text-center text-[10.5px] text-[var(--text-weak)]">
          You can also import Relay YAML from the test library.
        </p>
      </div>
    </section>
  );
}

function RecordChoice(props: { onRecord: () => void }) {
  return (
    <button
      type="button"
      class="grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-[12px] border border-[var(--v2-border-border-muted)] bg-[var(--v2-background-bg-layer-01)] px-3 py-3 text-left transition-[background-color,transform] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] hover:bg-[var(--v2-background-bg-layer-02)] active:scale-[0.985]"
      onClick={props.onRecord}
    >
      <span class={shellRecordDot} aria-hidden="true" />
      <span class="min-w-0">
        <strong class="block text-[12.5px] text-[var(--text-strong)]">Record instead</strong>
        <small class="mt-0.5 block text-[10.5px] text-[var(--text-weak)]">
          Use the app normally and capture each interaction.
        </small>
      </span>
      <Icon name="arrow-right" size={14} />
    </button>
  );
}

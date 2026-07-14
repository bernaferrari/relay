import { For, Show, createMemo } from "solid-js";
import type { TestAtlas } from "../../context/server";
import { cn } from "../../lib/cn";
import { Icon } from "../icon";

export function AtlasWorkspace(props: { atlas: TestAtlas | null; onOpen: (id: string) => void }) {
  const title = (id: string) => props.atlas?.nodes.find((node) => node.id === id)?.title ?? id;
  const tests = () => props.atlas?.nodes.length ?? 0;
  const duplicates = () => props.atlas?.duplicateClusters.length ?? 0;
  const savings = createMemo(() =>
    (props.atlas?.duplicateClusters ?? []).reduce((total, cluster) => total + cluster.savings, 0),
  );
  const maxCoverage = createMemo(() =>
    Math.max(1, ...(props.atlas?.coverage ?? []).map((item) => item.tests)),
  );

  return (
    <div class="h-full overflow-y-auto">
      <div class="mx-auto grid w-full max-w-[1180px] content-start gap-5 px-5 py-5 max-[760px]:px-3">
        <header class="flex items-center justify-between gap-4">
          <h2 class="m-0 text-[18px] font-semibold tracking-[-0.02em] text-text-strong">Atlas</h2>
          <div class="flex items-center gap-2">
            <AtlasStat value={tests()} label="tests" />
            <AtlasStat value={props.atlas?.coverage.length ?? 0} label="capabilities" />
            <AtlasStat value={savings()} label="steps to save" tone="brand" />
          </div>
        </header>

        <div class="grid grid-cols-[minmax(0,1.08fr)_minmax(340px,0.92fr)] gap-5 max-[900px]:grid-cols-1">
          <section class="overflow-hidden rounded-[18px] border border-[var(--relay-line)] bg-[var(--relay-panel)]">
            <header class="flex items-center justify-between gap-4 border-b border-[var(--relay-line)] px-5 py-3.5">
              <h3 class="m-0 text-[13px] font-semibold text-text-strong">Coverage</h3>
              <span class="rounded-full bg-surface-base-active px-2.5 py-1 font-mono text-[10px] text-text-weak">
                {props.atlas?.coverage.length ?? 0} tracked
              </span>
            </header>
            <div class="grid gap-1.5 p-3">
              <For
                each={props.atlas?.coverage ?? []}
                fallback={
                  <AtlasEmpty
                    icon="scan"
                    title="No coverage signal yet"
                    detail="Run or record a test and Atlas will organize the capabilities it exercises."
                  />
                }
              >
                {(item, index) => {
                  const width = () => Math.max(10, (item.tests / maxCoverage()) * 100);
                  return (
                    <div class="group grid grid-cols-[36px_minmax(0,1fr)_auto] items-center gap-3 rounded-xl px-2.5 py-3 transition-colors duration-150 hover:bg-white/[0.035]">
                      <span class="grid size-9 place-items-center rounded-[11px] bg-[color-mix(in_srgb,var(--relay-accent)_11%,transparent)] text-[var(--text-interactive-base)] ring-1 ring-inset ring-[color-mix(in_srgb,var(--relay-accent)_20%,transparent)]">
                        <Icon name={index() === 0 ? "pointer" : "bolt"} size={15} />
                      </span>
                      <div class="min-w-0">
                        <div class="mb-2 flex items-center justify-between gap-3">
                          <strong class="truncate text-[12.5px] font-medium text-text-base">
                            {item.capability}
                          </strong>
                          <span class="font-mono text-[10px] text-text-weaker">
                            {item.tests} test{item.tests === 1 ? "" : "s"}
                          </span>
                        </div>
                        <div class="h-1.5 overflow-hidden rounded-full bg-white/[0.055]">
                          <span
                            class="block h-full rounded-full bg-[var(--relay-accent)]"
                            style={{ width: `${width()}%` }}
                          />
                        </div>
                      </div>
                      <Icon
                        name="chevron-right"
                        size={13}
                        class="text-text-weaker opacity-0 transition-opacity group-hover:opacity-100"
                      />
                    </div>
                  );
                }}
              </For>
            </div>
          </section>

          <section class="overflow-hidden rounded-[18px] border border-[var(--relay-line)] bg-[var(--relay-panel)]">
            <header class="flex items-center justify-between gap-3 border-b border-[var(--relay-line)] px-5 py-3.5">
              <h3 class="m-0 text-[13px] font-semibold text-text-strong">Reuse opportunities</h3>
              <Show when={duplicates() > 0}>
                <span class="rounded-full bg-[color-mix(in_srgb,var(--relay-amber)_13%,transparent)] px-2.5 py-1 text-[10px] font-medium text-[var(--relay-amber)]">
                  {duplicates()} found
                </span>
              </Show>
            </header>
            <div class="grid gap-2 p-3">
              <For
                each={props.atlas?.duplicateClusters ?? []}
                fallback={
                  <AtlasEmpty
                    icon="check"
                    title="No repeated journeys"
                    detail="Atlas has not found any meaningful duplication in this suite."
                  />
                }
              >
                {(cluster) => (
                  <button
                    type="button"
                    class="group grid min-h-[78px] w-full grid-cols-[42px_minmax(0,1fr)_auto] items-center gap-3 rounded-[13px] border border-transparent bg-white/[0.025] px-3 text-left transition-[background-color,border-color,transform] duration-150 hover:border-[var(--relay-line)] hover:bg-white/[0.045] active:scale-[0.99]"
                    onClick={() => props.onOpen(cluster.recipeIds[0]!)}
                  >
                    <span class="relative grid size-10 place-items-center">
                      <i class="absolute top-1 left-0 grid size-7 place-items-center rounded-lg bg-[var(--relay-surface-strong)] text-text-weak ring-1 ring-[var(--relay-line)]">
                        <Icon name="bolt" size={12} />
                      </i>
                      <i class="absolute right-0 bottom-1 grid size-7 place-items-center rounded-lg bg-[color-mix(in_srgb,var(--relay-accent)_16%,var(--relay-surface-strong))] text-[var(--text-interactive-base)] ring-1 ring-[color-mix(in_srgb,var(--relay-accent)_26%,var(--relay-line))]">
                        <Icon name="bolt" size={12} />
                      </i>
                    </span>
                    <span class="min-w-0">
                      <strong class="block truncate text-[12.5px] font-medium text-text-base">
                        {cluster.recipeIds.map(title).join(" + ")}
                      </strong>
                      <small class="mt-1.5 inline-flex items-center gap-1.5 text-[10.5px] text-text-weaker">
                        <Icon name="sparkle" size={11} /> Save {cluster.savings} repeated step
                        {cluster.savings === 1 ? "" : "s"}
                      </small>
                    </span>
                    <span class="grid size-8 place-items-center rounded-lg text-text-weaker transition-[background-color,color,transform] group-hover:translate-x-0.5 group-hover:bg-surface-base-active group-hover:text-text-base">
                      <Icon name="arrow-right" size={14} />
                    </span>
                  </button>
                )}
              </For>
            </div>
          </section>
        </div>

        <Show when={duplicates() > 0}>
          <aside class="flex items-center gap-3 rounded-[14px] border border-border-weak-base bg-background-stronger px-5 py-3.5">
            <Icon name="sparkle" size={15} class="shrink-0 text-text-weaker" />
            <span class="min-w-0 text-[12px]/[1.45] text-text-weak">
              Consolidate {duplicates()} repeated journey{duplicates() === 1 ? "" : "s"} to remove
              roughly {savings()} repeated step{savings() === 1 ? "" : "s"} while keeping the same
              coverage.
            </span>
          </aside>
        </Show>
      </div>
    </div>
  );
}

function AtlasStat(props: { value: number; label: string; tone?: "brand" }) {
  return (
    <div class="grid min-w-[72px] gap-0.5 rounded-lg border border-border-weak-base bg-background-stronger px-2.5 py-1.5 text-center">
      <strong
        class={cn(
          "font-mono text-[15px]/none font-semibold tracking-[-0.02em] tabular-nums text-text-strong",
          props.tone === "brand" && "text-text-interactive-base",
        )}
      >
        {props.value}
      </strong>
      <small class="whitespace-nowrap text-[9.5px] text-text-weaker">{props.label}</small>
    </div>
  );
}

function AtlasEmpty(props: { icon: "scan" | "check"; title: string; detail: string }) {
  return (
    <div class="grid min-h-44 place-items-center px-6 py-8 text-center">
      <div class="max-w-[260px]">
        <span class="mx-auto grid size-10 place-items-center rounded-xl bg-surface-base-active text-text-weaker">
          <Icon name={props.icon} size={17} />
        </span>
        <strong class="mt-3 block text-[12.5px] font-medium text-text-base">{props.title}</strong>
        <p class="mt-1 text-[10.5px]/[1.5] text-text-weaker">{props.detail}</p>
      </div>
    </div>
  );
}

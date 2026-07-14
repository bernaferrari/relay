import { For } from "solid-js";
import type { TestAtlas } from "../../context/server";
import { Icon } from "../icon";

export function AtlasWorkspace(props: { atlas: TestAtlas | null; onOpen: (id: string) => void }) {
  const title = (id: string) => props.atlas?.nodes.find((node) => node.id === id)?.title ?? id;
  return (
    <div class="mx-auto grid w-full max-w-[1180px] content-start gap-4">
      <section class="grid grid-cols-3 overflow-hidden rounded-xl border border-border-weak-base bg-background-stronger [&>*+*]:border-l [&>*+*]:border-border-weak-base">
        {[
          [props.atlas?.nodes.length ?? 0, "Tests"],
          [props.atlas?.coverage.length ?? 0, "Capabilities"],
          [props.atlas?.duplicateClusters.length ?? 0, "Possible duplicates"],
        ].map(([value, label]) => (
          <div class="grid justify-items-center gap-1 p-4">
            <strong class="text-[24px]/none text-text-base">{value}</strong>
            <span class="text-[11px]/[1.25] text-text-weaker">{label}</span>
          </div>
        ))}
      </section>
      <div class="grid grid-cols-2 gap-4 max-[850px]:grid-cols-1">
        <section class="rounded-xl border border-border-weak-base bg-background-stronger p-4">
          <h3 class="text-[16px]/[1.25] text-text-base">Coverage</h3>
          <p class="mt-1 text-[11px]/[1.4] text-text-weaker">What your current tests exercise.</p>
          <div class="mt-4 grid gap-2">
            <For
              each={props.atlas?.coverage ?? []}
              fallback={
                <p class="py-8 text-center text-[12px]/[1.4] text-text-weaker">
                  No coverage to summarize yet.
                </p>
              }
            >
              {(item) => (
                <div class="flex min-h-10 items-center justify-between rounded-lg bg-surface-weak px-3">
                  <span class="text-[12px]/[1.25] text-text-base">{item.capability}</span>
                  <b class="text-[11px]/[1.25] text-text-weak">{item.tests}</b>
                </div>
              )}
            </For>
          </div>
        </section>
        <section class="rounded-xl border border-border-weak-base bg-background-stronger p-4">
          <h3 class="text-[16px]/[1.25] text-text-base">Consolidation</h3>
          <p class="mt-1 text-[11px]/[1.4] text-text-weaker">
            Repeated paths that may belong in one parametrized test.
          </p>
          <div class="mt-4 grid gap-2">
            <For
              each={props.atlas?.duplicateClusters ?? []}
              fallback={
                <p class="py-8 text-center text-[12px]/[1.4] text-text-weaker">
                  No duplicate paths found.
                </p>
              }
            >
              {(cluster) => (
                <button
                  type="button"
                  class="flex min-h-12 items-center justify-between gap-3 rounded-lg bg-surface-weak px-3 text-left hover:bg-surface-base-hover"
                  onClick={() => props.onOpen(cluster.recipeIds[0]!)}
                >
                  <span class="min-w-0">
                    <strong class="block truncate text-[12px]/[1.25] text-text-base">
                      {cluster.recipeIds.map(title).join(" + ")}
                    </strong>
                    <small class="mt-1 block text-[10px]/[1.25] text-text-weaker">
                      Could save {cluster.savings} repeated steps
                    </small>
                  </span>
                  <Icon name="arrow-right" size={14} />
                </button>
              )}
            </For>
          </div>
        </section>
      </div>
    </div>
  );
}

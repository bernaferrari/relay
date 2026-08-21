import { For, Show, createMemo } from "solid-js";
import type { LocaleMatrixCase } from "@relay/protocol";
import type { LocalExecutionTargetOption } from "../lib/local-execution-targets";
import {
  localeMatrixCaseTargetBindingFor,
  type LocaleMatrixCaseTargetBinding,
} from "../lib/locale-matrix-admission";
import { cn } from "../lib/cn";
import { LocalExecutionTargetPicker } from "./local-execution-target-picker";

/** Responsive, target-affine case assignments. A case remains a separate card
 * on small screens so a long translated label cannot obscure its target. */
export function LocaleMatrixTargetGrid(props: {
  cases: readonly LocaleMatrixCase[];
  bindings: readonly LocaleMatrixCaseTargetBinding[];
  targets: readonly LocalExecutionTargetOption[];
  busy?: boolean;
  onBind: (item: LocaleMatrixCase, target?: LocalExecutionTargetOption["target"]) => void;
}) {
  const repeatCounts = createMemo(() => {
    const counts = new Map<string, number>();
    for (const item of props.cases) counts.set(item.locale, (counts.get(item.locale) ?? 0) + 1);
    return counts;
  });

  return (
    <section class="grid gap-2" aria-labelledby="locale-case-targets-title">
      <div class="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h3
            id="locale-case-targets-title"
            class="m-0 text-caption font-semibold text-[var(--text-strong)]"
          >
            Case targets
          </h3>
          <p class="m-0 mt-0.5 max-w-prose text-micro/[1.4] text-[var(--text-weak)]">
            Assign each frozen locale case to an attached Android or iOS lane. Restore cases are
            separate work and must be assigned too.
          </p>
        </div>
        <span class="text-micro tabular-nums text-[var(--text-weak)]">
          {props.bindings.length}/{props.cases.length} bound
        </span>
      </div>
      <div class="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
        <For each={props.cases}>
          {(item, index) => {
            const binding = () => localeMatrixCaseTargetBindingFor(props.bindings, item);
            const repeated = () => (repeatCounts().get(item.locale) ?? 0) > 1;
            const isRestore = () =>
              repeated() &&
              index() === props.cases.length - 1 &&
              props.cases.some(
                (prior, priorIndex) => priorIndex < index() && prior.locale === item.locale,
              );
            return (
              <article
                class={cn(
                  "grid min-w-0 gap-2 rounded-xl border border-[var(--border-weak-base)] bg-[var(--surface-base)] p-3",
                  binding() ? "shadow-[var(--shadow-xs-border-base)]" : undefined,
                )}
                data-locale-matrix-case={item.caseIndex}
              >
                <div class="grid min-w-0 gap-1">
                  <div class="flex flex-wrap items-center gap-1.5 text-micro text-[var(--text-weak)]">
                    <span class="tabular-nums">Case {item.caseIndex + 1}</span>
                    <Show when={isRestore()}>
                      <span class="rounded-full bg-[var(--surface-base-hover)] px-1.5 py-0.5 text-[var(--text-base)]">
                        Restore
                      </span>
                    </Show>
                  </div>
                  <strong class="whitespace-pre-wrap break-words text-caption/[1.35] font-medium text-[var(--text-strong)]">
                    {item.locale}
                  </strong>
                </div>
                <LocalExecutionTargetPicker
                  label={`Local target for locale case ${item.caseIndex + 1}: ${item.locale}`}
                  targets={props.targets}
                  target={binding()?.executionTarget}
                  busy={props.busy}
                  emptyLabel="Choose target for this case…"
                  onBind={(target) => props.onBind(item, target)}
                />
              </article>
            );
          }}
        </For>
      </div>
    </section>
  );
}

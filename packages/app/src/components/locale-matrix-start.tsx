import { Show, createMemo, createResource, createSignal } from "solid-js";
import type {
  LocaleMatrixMaterializationInput,
  LocaleMatrixMaterializedScope,
} from "@relay/protocol";
import { Button } from "@relay/ui/button";
import { useServer } from "../context/server";
import { cn } from "../lib/cn";
import { createLocaleMatrixLocalAdmission } from "../lib/use-locale-matrix-local-admission";
import { Icon } from "./icon";
import { LocaleMatrixLocalAdmission } from "./locale-matrix-local-admission";
import { LocaleMatrixTargetGrid } from "./locale-matrix-target-grid";

/**
 * A complete target-affine Locale Matrix launch surface. It first asks Relay
 * for the canonical, target-free plan; only then can a person assign case
 * targets, fetch measured timing evidence, and start a local device-farm run.
 */
export function LocaleMatrixStart(props: {
  recipeId?: string;
  appMapId?: string;
  flowId?: string;
  testId?: string;
  variableId?: string;
  locales?: readonly string[];
  scope?: LocaleMatrixMaterializedScope;
  profileId?: string;
  preset?: "grok";
  title?: string;
  class?: string;
  onStarted?: () => void;
}) {
  const server = useServer();
  const [starting, setStarting] = createSignal(false);
  const materializationInput = createMemo<LocaleMatrixMaterializationInput>(() => ({
    ...(props.appMapId?.trim() && props.testId?.trim() && props.variableId?.trim()
      ? {
          appMapId: props.appMapId.trim(),
          testId: props.testId.trim(),
          variableId: props.variableId.trim(),
        }
      : props.appMapId?.trim() && props.flowId?.trim()
        ? { appMapId: props.appMapId.trim(), flowId: props.flowId.trim() }
        : { recipe: props.recipeId?.trim() ?? "" }),
    ...(props.locales?.length ? { locales: [...props.locales] } : {}),
    ...(props.scope ? { scope: structuredClone(props.scope) } : {}),
    ...(props.profileId?.trim() ? { profileId: props.profileId.trim() } : {}),
    ...(props.preset ? { preset: props.preset } : {}),
  }));
  const materializationKey = createMemo(() =>
    server.health() === "online" ? JSON.stringify(materializationInput()) : null,
  );
  const [materialization, { refetch }] = createResource(materializationKey, () =>
    server.localeMatrix.materialize(materializationInput()),
  );
  const admission = createLocaleMatrixLocalAdmission({
    materialization: () => materialization(),
    server: {
      devices: server.devices,
      health: server.health,
      estimateCampaignDurationCohorts: server.estimateCampaignDurationCohorts,
      preflightLocalCampaignAdmission: server.preflightLocalCampaignAdmission,
    },
  });
  const busy = createMemo(
    () =>
      materialization.loading || starting() || admission.loadingEvidence() || admission.checking(),
  );
  const startIssue = createMemo(() => {
    const plan = materialization();
    if (!plan) {
      return materialization.error instanceof Error
        ? materialization.error.message
        : "Materializing the exact locale cases…";
    }
    if (!admission.localCampaignMode()) return "";
    if (!admission.targetsReady()) {
      return "Every bound local target must be attached and ready before deadline admission.";
    }
    const request = admission.fullRequest();
    return "issue" in request ? request.issue : "";
  });

  async function start() {
    const plan = materialization();
    if (!plan || busy() || startIssue()) return;
    setStarting(true);
    try {
      const explicitTargets = admission.localCampaignMode();
      const admitted = explicitTargets ? await admission.prepareForStart() : undefined;
      if (explicitTargets && !admitted) return;
      const started = await server.localeMatrix.run(plan.source.recipeId, plan.scope.locales, {
        ...(plan.source.kind === "app-map-flow"
          ? {
              appMapId: plan.source.appMapId,
              flowId: plan.source.flowId,
              expectedAppMapRevision: plan.source.appMapRevision,
            }
          : plan.source.kind === "app-map-test"
            ? {
                appMapId: plan.source.appMapId,
                testId: plan.source.testId,
                variableId: plan.source.variableId,
                expectedAppMapRevision: plan.source.appMapRevision,
              }
            : {}),
        scope: plan.scope,
        ...(props.profileId?.trim() ? { profileId: props.profileId.trim() } : {}),
        ...(props.preset ? { preset: props.preset } : {}),
        title: props.title,
        ...(admitted
          ? {
              caseTargetBindings: admitted.bindings,
              localAdmission: admitted.request,
            }
          : {}),
      });
      if (started) props.onStarted?.();
    } finally {
      setStarting(false);
    }
  }

  return (
    <section
      class={cn(
        "grid gap-4 rounded-2xl border border-[var(--border-weak-base)] bg-[var(--background-base)] p-3 sm:p-4",
        props.class,
      )}
      aria-labelledby="locale-matrix-start-title"
    >
      <header class="flex flex-wrap items-start justify-between gap-3">
        <div class="min-w-0">
          <h2
            id="locale-matrix-start-title"
            class="m-0 text-body font-semibold text-[var(--text-strong)]"
          >
            Locale Matrix
          </h2>
          <p class="m-0 mt-0.5 max-w-prose text-caption/[1.45] text-[var(--text-weak)]">
            Review the frozen case plan before running. Assigning any case enters explicit local
            device-farm mode; reset it explicitly to return to one selected device.
          </p>
        </div>
        <Button
          variant="secondary"
          size="sm"
          class="min-h-11 shrink-0"
          disabled={busy()}
          onClick={() => void refetch()}
        >
          <Icon name="refresh" size={11} />
          {materialization.loading ? "Materializing…" : "Refresh plan"}
        </Button>
      </header>

      <Show
        when={materialization()}
        fallback={
          <p
            class="m-0 rounded-xl bg-[var(--surface-base)] px-3 py-2.5 text-micro/[1.45] text-[var(--text-weak)]"
            role={materialization.error ? "alert" : undefined}
          >
            {materialization.error instanceof Error
              ? materialization.error.message
              : "Reading the target-free locale plan…"}
          </p>
        }
      >
        {(plan) => (
          <>
            <div class="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-[var(--surface-base)] px-3 py-2">
              <span class="min-w-0 break-words text-micro/[1.4] text-[var(--text-base)]">
                {plan().cases.length} frozen {plan().cases.length === 1 ? "case" : "cases"} · timing
                cohort <strong class="font-medium">{plan().durationCohort.testId}</strong>
              </span>
              <span class="text-micro text-[var(--text-weak)]">
                {plan().source.kind === "app-map-flow"
                  ? "App Map flow"
                  : plan().source.kind === "app-map-test"
                    ? "Saved App Map Test"
                    : "Saved recipe"}
              </span>
            </div>
            <LocaleMatrixTargetGrid
              cases={plan().cases}
              bindings={admission.caseTargetBindings()}
              targets={admission.localTargets()}
              busy={busy()}
              onBind={admission.bindCaseTarget}
            />
            <Show when={admission.localCampaignMode()}>
              <div class="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--border-weak-base)] bg-[var(--surface-base)] px-3 py-2.5">
                <p class="m-0 min-w-0 text-micro/[1.4] text-[var(--text-weak)]">
                  Explicit local targets stay active after a refreshed plan. Rebind every case, or
                  deliberately return to the selected-device path.
                </p>
                <Button
                  variant="secondary"
                  size="sm"
                  class="min-h-11 shrink-0"
                  disabled={busy()}
                  onClick={() => admission.resetBindings()}
                >
                  <Icon name="undo" size={11} />
                  Reset to selected device
                </Button>
              </div>
              <LocaleMatrixLocalAdmission
                admission={admission}
                caseCount={plan().cases.length}
                busy={busy()}
              />
            </Show>
            <footer class="flex flex-col gap-2 border-t border-[var(--border-weak-base)] pt-3 sm:flex-row sm:items-center sm:justify-between">
              <p class="m-0 min-w-0 text-micro/[1.4] text-[var(--text-weak)]" aria-live="polite">
                {startIssue() ||
                  (admission.localCampaignMode()
                    ? "Capacity is checked against the exact bound targets when you start."
                    : "No explicit bindings: this uses the deliberately retained selected-device path.")}
              </p>
              <Button
                variant="primary"
                size="sm"
                class="min-h-11 shrink-0"
                disabled={Boolean(startIssue()) || busy()}
                aria-busy={starting()}
                onClick={() => void start()}
              >
                <Icon name="play" size={11} />
                {starting()
                  ? "Starting…"
                  : admission.localCampaignMode()
                    ? "Start admitted matrix"
                    : "Run on selected device"}
              </Button>
            </footer>
          </>
        )}
      </Show>
    </section>
  );
}

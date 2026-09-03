import { For, Show, createMemo, createSignal, onMount } from "solid-js";
import { Button } from "@relay/ui/button";
import {
  type ChangeVerification,
  type OperationOutput,
  type ProofSetupPreview,
} from "@relay/protocol";
import { useServer } from "../context/server";
import { cn } from "../lib/cn";
import { humanError } from "../lib/human-error";
import { eyebrow, mono } from "../lib/ui";
import { confirmAction } from "./confirm-dialog";

type SetupInspection = OperationOutput<"proof.setup.inspect">;

const fieldClass =
  "min-h-11 w-full rounded-lg border border-border-weak-base bg-surface-base px-3 py-2 text-title/[1.4] text-text-strong outline-none transition-[border-color,box-shadow] placeholder:text-text-weaker focus-visible:border-border-focus focus-visible:ring-2 focus-visible:ring-border-strong-focus disabled:cursor-not-allowed disabled:text-text-weaker";

function candidateKey(appMapId: string, testId: string): string {
  return `${appMapId}\0${testId}`;
}

export function ChangesProofSetup(props: {
  baseRef?: string;
  onCancel: () => void;
  onPrepared: (proof: ChangeVerification) => void;
}) {
  const server = useServer();
  const [inspection, setInspection] = createSignal<SetupInspection | null>(null);
  const [preview, setPreview] = createSignal<ProofSetupPreview | null>(null);
  const [busy, setBusy] = createSignal<"inspect" | "preview" | "apply" | null>("inspect");
  const [error, setError] = createSignal<string | null>(null);
  const [executable, setExecutable] = createSignal("");
  const [args, setArgs] = createSignal("");
  const [artifactPath, setArtifactPath] = createSignal("");
  const [platform, setPlatform] = createSignal<"android" | "ios" | "web">("web");
  const [buildId, setBuildId] = createSignal("local-proof-build");
  const [buildName, setBuildName] = createSignal("Local Proof build");
  const [configuration, setConfiguration] = createSignal("local.release");
  const [environmentRevision, setEnvironmentRevision] = createSignal("local-reviewed-v1");
  const [applicationId, setApplicationId] = createSignal("");
  const [deploymentUrl, setDeploymentUrl] = createSignal("");
  const [deploymentDigest, setDeploymentDigest] = createSignal("");
  const [selectedTests, setSelectedTests] = createSignal<readonly string[]>([]);
  const [confidence, setConfidence] = createSignal<"definite" | "probable">("definite");
  const [coverageReason, setCoverageReason] = createSignal("");
  const [selectedTargets, setSelectedTargets] = createSignal<readonly string[]>([]);

  const compatibleTargets = createMemo(
    () =>
      inspection()?.candidates.targets.filter(
        (target) => target.platform === (platform() === "web" ? "browser" : platform()),
      ) ?? [],
  );

  async function inspect(): Promise<void> {
    setBusy("inspect");
    setError(null);
    try {
      const result = await server.runAction(
        "proof.setup.inspect",
        props.baseRef ? { baseRef: props.baseRef } : {},
      );
      setInspection(result);
      const command = result.candidates.commands[0];
      if (command) {
        setExecutable(command.executable);
        setArgs(command.args.join("\n"));
      }
      const artifact = result.candidates.artifacts[0];
      if (artifact) {
        setArtifactPath(artifact.path);
        setPlatform(artifact.platform);
      }
    } catch (cause) {
      setError(humanError(cause, "Could not inspect Proof setup candidates"));
    } finally {
      setBusy(null);
    }
  }

  onMount(() => void inspect());

  function toggleSelection(
    current: readonly string[],
    value: string,
    set: (next: readonly string[]) => void,
  ): void {
    set(current.includes(value) ? current.filter((item) => item !== value) : [...current, value]);
  }

  async function createPreview(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (busy()) return;
    const observed = inspection();
    if (!observed) return;
    const command = executable().trim();
    const artifact = artifactPath().trim();
    if (!command) {
      setError("Build command is required. Choose a candidate or enter one.");
      return;
    }
    if (!artifact) {
      setError("Artifact path is required. Choose or enter the generated output.");
      return;
    }
    if (!selectedTests().length) {
      setError("Choose at least one reviewed Test for the changed files.");
      return;
    }
    if (!coverageReason().trim()) {
      setError("Explain why the selected Tests cover this change.");
      return;
    }
    if (!selectedTargets().length) {
      setError("Choose at least one required target for this Proof.");
      return;
    }
    if (platform() === "web" && !deploymentUrl().trim()) {
      setError("Web deployment URL is required to bind the built output to its runtime.");
      return;
    }
    if (
      platform() === "web" &&
      deploymentDigest().trim() &&
      !/^sha256:[a-f0-9]{64}$/u.test(deploymentDigest().trim())
    ) {
      setError("Web deployment digest must be sha256: followed by 64 lowercase hex characters.");
      return;
    }

    const selectedTestSet = new Set(selectedTests());
    const associations = observed.candidates.tests
      .filter((test) => selectedTestSet.has(candidateKey(test.appMapId, test.testId)))
      .map((test, index) => ({
        id: `setup-${index + 1}-${test.appMapId}-${test.testId}`.slice(0, 256),
        appMapId: test.appMapId,
        testId: test.testId,
        signals: {
          files: observed.change.changedFiles,
          symbols: [],
          routes: [],
          resources: [],
          localizationKeys: [],
          apiContracts: [],
        },
        confidence: confidence(),
        reason: coverageReason().trim(),
        review: {
          status: "reviewed" as const,
          revision: 1,
          reviewedBy: server.actorId(),
          reviewedAt: Date.now(),
        },
      }));
    const targetSet = new Set(selectedTargets());
    const targetCases = compatibleTargets()
      .filter((target) => targetSet.has(target.targetId))
      .map((target) => target.targetCase);

    setBusy("preview");
    setError(null);
    try {
      setPreview(
        await server.runAction("proof.setup.preview", {
          ...(props.baseRef ? { baseRef: props.baseRef } : {}),
          build: {
            id: buildId().trim(),
            name: buildName().trim(),
            platform: platform(),
            command: {
              executable: command,
              args: args()
                .split("\n")
                .map((value) => value.trim())
                .filter(Boolean),
            },
            artifactPath: artifact,
            configuration: configuration().trim(),
            environmentRevision:
              platform() === "web" ? "provider-derived" : environmentRevision().trim(),
            ...(applicationId().trim() ? { applicationId: applicationId().trim() } : {}),
            ...(platform() === "web"
              ? {
                  webDeployment: {
                    url: deploymentUrl().trim(),
                    ...(deploymentDigest().trim()
                      ? { deploymentDigest: deploymentDigest().trim() as `sha256:${string}` }
                      : {}),
                  },
                }
              : {}),
          },
          associations,
          targetCases,
        }),
      );
    } catch (cause) {
      setError(humanError(cause, "Could not build and preview this Proof setup"));
    } finally {
      setBusy(null);
    }
  }

  function applyPreview(): void {
    const reviewed = preview();
    if (!reviewed || busy()) return;
    confirmAction({
      title: "Apply this repository Proof setup?",
      body: `Relay will register ${reviewed.build.name}, write ${reviewed.policy.path}, and prepare the exact ${reviewed.testedSha.slice(0, 12)} revision. Any drift from this preview will stop the operation.`,
      confirmLabel: "Apply reviewed setup",
      tone: "default",
      onConfirm: async () => {
        setBusy("apply");
        setError(null);
        try {
          await server.runAction("proof.setup.apply", { ...reviewed, confirm: true });
          const result = await server.runAction(
            "proof.prepare",
            props.baseRef ? { baseRef: props.baseRef } : {},
          );
          props.onPrepared(result.proof);
        } catch (cause) {
          setError(humanError(cause, "Could not apply the reviewed Proof setup"));
        } finally {
          setBusy(null);
        }
      },
    });
  }

  return (
    <section
      class="mx-auto grid w-full max-w-[860px] gap-5 rounded-2xl bg-surface-raised-stronger-non-alpha p-[clamp(1rem,3vw,1.75rem)] ring-1 ring-inset ring-border-weak-base"
      aria-label="Set up repository Proof policy"
    >
      <div class="grid gap-1">
        <span class={eyebrow}>Repository setup</span>
        <h2 class="m-0 text-title font-semibold text-text-strong">Build exact proof inputs</h2>
        <p class="m-0 max-w-[65ch] text-body/[1.5] text-text-base">
          Choose an explicit local build, reviewed Tests, and required targets. Relay suggests
          candidates, but nothing becomes coverage until you preview and confirm it.
        </p>
      </div>

      <Show when={busy() === "inspect"}>
        <p class="m-0 text-body text-text-base" role="status">
          Inspecting build scripts, artifacts, Tests, and targets…
        </p>
      </Show>

      <Show when={!preview() ? inspection() : null}>
        {(observed) => (
          <form class="grid gap-5" onSubmit={(event) => void createPreview(event)}>
            <fieldset class="grid gap-4 rounded-xl border-0 bg-surface-base p-4 ring-1 ring-inset ring-border-weak-base">
              <legend class="px-1 text-body font-semibold text-text-strong">
                1. Build and artifact
              </legend>
              <div class="grid grid-cols-2 gap-3 max-[680px]:grid-cols-1">
                <SetupField label="Build command" id="proof-setup-command">
                  <select
                    id="proof-setup-command"
                    class={fieldClass}
                    value=""
                    disabled={Boolean(busy())}
                    onChange={(event) => {
                      const candidate =
                        observed().candidates.commands[Number(event.currentTarget.value)];
                      if (!candidate) return;
                      setExecutable(candidate.executable);
                      setArgs(candidate.args.join("\n"));
                    }}
                  >
                    <option value="">Choose a discovered command…</option>
                    <For each={observed().candidates.commands}>
                      {(candidate, index) => (
                        <option value={index()}>
                          {candidate.executable} {candidate.args.join(" ")}
                        </option>
                      )}
                    </For>
                  </select>
                </SetupField>
                <SetupField label="Generated artifact" id="proof-setup-artifact">
                  <select
                    id="proof-setup-artifact"
                    class={fieldClass}
                    value=""
                    disabled={Boolean(busy())}
                    onChange={(event) => {
                      const artifact =
                        observed().candidates.artifacts[Number(event.currentTarget.value)];
                      if (!artifact) return;
                      setArtifactPath(artifact.path);
                      setPlatform(artifact.platform);
                      setSelectedTargets([]);
                    }}
                  >
                    <option value="">Choose a discovered artifact…</option>
                    <For each={observed().candidates.artifacts}>
                      {(artifact, index) => <option value={index()}>{artifact.path}</option>}
                    </For>
                  </select>
                </SetupField>
              </div>
              <div class="grid grid-cols-2 gap-3 max-[680px]:grid-cols-1">
                <SetupField label="Executable" id="proof-setup-executable">
                  <input
                    id="proof-setup-executable"
                    class={fieldClass}
                    value={executable()}
                    disabled={Boolean(busy())}
                    autocomplete="off"
                    spellcheck={false}
                    onInput={(event) => setExecutable(event.currentTarget.value)}
                  />
                </SetupField>
                <SetupField label="Arguments (one per line)" id="proof-setup-args">
                  <textarea
                    id="proof-setup-args"
                    class={cn(fieldClass, "min-h-24 resize-y font-mono")}
                    value={args()}
                    disabled={Boolean(busy())}
                    autocomplete="off"
                    spellcheck={false}
                    onInput={(event) => setArgs(event.currentTarget.value)}
                  />
                </SetupField>
                <SetupField label="Artifact path" id="proof-setup-artifact-path">
                  <input
                    id="proof-setup-artifact-path"
                    class={fieldClass}
                    value={artifactPath()}
                    disabled={Boolean(busy())}
                    autocomplete="off"
                    spellcheck={false}
                    onInput={(event) => setArtifactPath(event.currentTarget.value)}
                  />
                </SetupField>
                <SetupField label="Platform" id="proof-setup-platform">
                  <select
                    id="proof-setup-platform"
                    class={fieldClass}
                    value={platform()}
                    disabled={Boolean(busy())}
                    onChange={(event) => {
                      setPlatform(event.currentTarget.value as "android" | "ios" | "web");
                      setSelectedTargets([]);
                    }}
                  >
                    <option value="web">Web deployment</option>
                    <option value="android">Android (.apk)</option>
                    <option value="ios">iOS simulator (.app)</option>
                  </select>
                </SetupField>
                <SetupField label="Build ID" id="proof-setup-build-id">
                  <input
                    id="proof-setup-build-id"
                    class={fieldClass}
                    value={buildId()}
                    disabled={Boolean(busy())}
                    autocomplete="off"
                    spellcheck={false}
                    onInput={(event) => setBuildId(event.currentTarget.value)}
                  />
                </SetupField>
                <SetupField label="Build name" id="proof-setup-build-name">
                  <input
                    id="proof-setup-build-name"
                    class={fieldClass}
                    value={buildName()}
                    disabled={Boolean(busy())}
                    autocomplete="off"
                    onInput={(event) => setBuildName(event.currentTarget.value)}
                  />
                </SetupField>
                <SetupField label="Configuration" id="proof-setup-configuration">
                  <input
                    id="proof-setup-configuration"
                    class={fieldClass}
                    value={configuration()}
                    disabled={Boolean(busy())}
                    autocomplete="off"
                    spellcheck={false}
                    onInput={(event) => setConfiguration(event.currentTarget.value)}
                  />
                </SetupField>
                <SetupField
                  label={
                    platform() === "web" ? "Provider environment revision" : "Environment revision"
                  }
                  id="proof-setup-environment"
                >
                  <input
                    id="proof-setup-environment"
                    class={fieldClass}
                    value={
                      platform() === "web"
                        ? "Derived from the Vercel deployment"
                        : environmentRevision()
                    }
                    disabled={Boolean(busy()) || platform() === "web"}
                    autocomplete="off"
                    spellcheck={false}
                    onInput={(event) => setEnvironmentRevision(event.currentTarget.value)}
                  />
                </SetupField>
              </div>
              <SetupField label="Application ID (optional)" id="proof-setup-app-id">
                <input
                  id="proof-setup-app-id"
                  class={fieldClass}
                  value={applicationId()}
                  disabled={Boolean(busy())}
                  autocomplete="off"
                  spellcheck={false}
                  placeholder="com.example.app"
                  onInput={(event) => setApplicationId(event.currentTarget.value)}
                />
              </SetupField>
              <Show when={platform() === "web"}>
                <div class="grid grid-cols-2 gap-3 max-[680px]:grid-cols-1">
                  <SetupField label="Immutable deployment URL" id="proof-setup-deployment-url">
                    <input
                      id="proof-setup-deployment-url"
                      class={fieldClass}
                      type="url"
                      value={deploymentUrl()}
                      disabled={Boolean(busy())}
                      autocomplete="url"
                      spellcheck={false}
                      placeholder="https://preview.example.test"
                      onInput={(event) => setDeploymentUrl(event.currentTarget.value)}
                    />
                  </SetupField>
                  <SetupField
                    label="Provider deployment digest (optional)"
                    id="proof-setup-deployment-digest"
                  >
                    <input
                      id="proof-setup-deployment-digest"
                      class={fieldClass}
                      value={deploymentDigest()}
                      disabled={Boolean(busy())}
                      autocomplete="off"
                      spellcheck={false}
                      placeholder="Derived by Vercel when configured"
                      onInput={(event) => setDeploymentDigest(event.currentTarget.value)}
                    />
                  </SetupField>
                </div>
                <p class="m-0 text-caption/[1.45] text-text-weak">
                  Relay hashes the local web output for drift checks. When the Vercel provider is
                  configured, it verifies the immutable deployment and derives its digest from
                  provider facts; you do not need to copy a digest from a dashboard. A directory
                  hash alone cannot claim the deployed runtime.
                </p>
              </Show>
            </fieldset>

            <fieldset class="grid gap-3 rounded-xl border-0 bg-surface-base p-4 ring-1 ring-inset ring-border-weak-base">
              <legend class="px-1 text-body font-semibold text-text-strong">
                2. Reviewed Tests
              </legend>
              <p class="m-0 text-caption/[1.45] text-text-weak">
                Selecting a Test explicitly associates every changed file shown by Git with that
                Test.
              </p>
              <div class="grid gap-2">
                <For each={observed().candidates.tests}>
                  {(test) => {
                    const key = candidateKey(test.appMapId, test.testId);
                    return (
                      <label class="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg px-3 py-2 ring-1 ring-inset ring-border-weak-base">
                        <input
                          type="checkbox"
                          checked={selectedTests().includes(key)}
                          disabled={Boolean(busy())}
                          onChange={() => toggleSelection(selectedTests(), key, setSelectedTests)}
                        />
                        <span class="grid min-w-0 gap-0.5">
                          <strong class="truncate text-body font-medium text-text-strong">
                            {test.name}
                          </strong>
                          <span class={cn(mono, "truncate text-caption text-text-weak")}>
                            {test.appMapId}/{test.testId}
                          </span>
                        </span>
                      </label>
                    );
                  }}
                </For>
              </div>
              <div class="grid grid-cols-[minmax(0,1fr)_180px] gap-3 max-[680px]:grid-cols-1">
                <SetupField label="Coverage rationale" id="proof-setup-reason">
                  <textarea
                    id="proof-setup-reason"
                    class={cn(fieldClass, "min-h-24 resize-y")}
                    value={coverageReason()}
                    disabled={Boolean(busy())}
                    rows={3}
                    onInput={(event) => setCoverageReason(event.currentTarget.value)}
                  />
                </SetupField>
                <SetupField label="Confidence" id="proof-setup-confidence">
                  <select
                    id="proof-setup-confidence"
                    class={fieldClass}
                    value={confidence()}
                    disabled={Boolean(busy())}
                    onChange={(event) =>
                      setConfidence(event.currentTarget.value as "definite" | "probable")
                    }
                  >
                    <option value="definite">Definite</option>
                    <option value="probable">Probable</option>
                  </select>
                </SetupField>
              </div>
            </fieldset>

            <fieldset class="grid gap-3 rounded-xl border-0 bg-surface-base p-4 ring-1 ring-inset ring-border-weak-base">
              <legend class="px-1 text-body font-semibold text-text-strong">
                3. Required targets
              </legend>
              <Show
                when={compatibleTargets().length}
                fallback={
                  <p class="m-0 text-body text-text-critical-base" role="alert">
                    No observed {platform()} target is available. Connect one, inspect again, then
                    choose it explicitly.
                  </p>
                }
              >
                <For each={compatibleTargets()}>
                  {(target) => (
                    <label class="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg px-3 py-2 ring-1 ring-inset ring-border-weak-base">
                      <input
                        type="checkbox"
                        checked={selectedTargets().includes(target.targetId)}
                        disabled={Boolean(busy())}
                        onChange={() =>
                          toggleSelection(selectedTargets(), target.targetId, setSelectedTargets)
                        }
                      />
                      <span class="grid min-w-0 gap-0.5">
                        <strong class="truncate text-body font-medium text-text-strong">
                          {target.name}
                        </strong>
                        <span class={cn(mono, "truncate text-caption text-text-weak")}>
                          {target.targetId}
                        </span>
                      </span>
                    </label>
                  )}
                </For>
              </Show>
            </fieldset>

            <div class="flex flex-wrap items-center justify-between gap-3 border-t border-border-weak-base pt-4">
              <Button
                type="button"
                variant="secondary"
                disabled={Boolean(busy())}
                onClick={props.onCancel}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                variant="primary"
                disabled={Boolean(busy()) || !compatibleTargets().length}
              >
                {busy() === "preview" ? "Building…" : "Build and preview policy"}
              </Button>
            </div>
          </form>
        )}
      </Show>

      <Show when={preview()}>
        {(reviewed) => (
          <div class="grid gap-4">
            <div class="grid gap-3 rounded-xl bg-surface-base p-4 ring-1 ring-inset ring-border-weak-base">
              <div class="grid gap-1">
                <span class={eyebrow}>Exact preview</span>
                <strong class="text-title font-semibold text-text-strong">
                  Review before writing
                </strong>
              </div>
              <dl class="m-0 grid grid-cols-[140px_minmax(0,1fr)] gap-x-4 gap-y-2 text-body max-[620px]:grid-cols-1 max-[620px]:gap-y-1">
                <dt class="text-text-weak">Command</dt>
                <dd class={cn(mono, "m-0 break-all text-text-strong")}>
                  {reviewed().command.executable} {reviewed().command.args.join(" ")}
                </dd>
                <dt class="text-text-weak">Artifact</dt>
                <dd class="m-0 text-text-strong">{reviewed().artifact.path}</dd>
                <dt class="text-text-weak">Artifact digest</dt>
                <dd class={cn(mono, "m-0 break-all text-caption text-text-strong")}>
                  {reviewed().artifact.digest}
                </dd>
                <dt class="text-text-weak">Revision</dt>
                <dd class={cn(mono, "m-0 text-text-strong")}>{reviewed().testedSha}</dd>
                <dt class="text-text-weak">Reviewed Tests</dt>
                <dd class="m-0 text-text-strong">
                  {reviewed().policy.document.associations.length}
                </dd>
                <dt class="text-text-weak">Required targets</dt>
                <dd class="m-0 text-text-strong">
                  {
                    reviewed().policy.document.targetCases.filter((target) => target.required)
                      .length
                  }
                </dd>
              </dl>
              <details class="rounded-lg bg-surface-raised-stronger-non-alpha p-3 ring-1 ring-inset ring-border-weak-base">
                <summary class="min-h-11 cursor-pointer py-2 text-body font-medium text-text-strong">
                  Review generated .relay/change-proof.json
                </summary>
                <pre class="m-0 max-h-80 overflow-auto whitespace-pre-wrap break-words text-caption/[1.45] text-text-base">
                  {JSON.stringify(reviewed().policy.document, null, 2)}
                </pre>
              </details>
            </div>
            <div class="flex flex-wrap items-center justify-between gap-3 border-t border-border-weak-base pt-4">
              <Button
                type="button"
                variant="secondary"
                disabled={Boolean(busy())}
                onClick={() => {
                  setPreview(null);
                  setError(null);
                }}
              >
                Edit setup
              </Button>
              <Button
                type="button"
                variant="primary"
                disabled={Boolean(busy())}
                onClick={applyPreview}
              >
                {busy() === "apply" ? "Applying…" : "Apply reviewed setup"}
              </Button>
            </div>
          </div>
        )}
      </Show>

      <Show when={error()}>
        {(message) => (
          <p
            class="m-0 rounded-lg bg-surface-critical-weak px-3 py-2 text-body text-text-critical-base ring-1 ring-inset ring-border-critical-base/40"
            role="alert"
          >
            {message()}
          </p>
        )}
      </Show>
    </section>
  );
}

function SetupField(props: { label: string; id: string; children: unknown }) {
  return (
    <label class="grid gap-1.5 text-caption font-medium text-text-strong" for={props.id}>
      <span>{props.label}</span>
      {props.children as never}
    </label>
  );
}

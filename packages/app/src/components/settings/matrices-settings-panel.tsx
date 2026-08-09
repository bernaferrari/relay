import { For, Show, createSignal } from "solid-js";
import type { CompatibilityMatrix } from "@relay/protocol";
import { Button } from "@relay/ui/button";
import { IconButton } from "@relay/ui/icon-button";
import { useServer } from "../../context/server";
import { Icon } from "../icon";
import { matrixSummary } from "../matrix-selector-editor";
import { TestEnvironmentEditor } from "./test-environment-editor";

const NEW_ENVIRONMENT = "__new__";

export function MatricesSettingsPanel() {
  const server = useServer();
  let matrixFileInput: HTMLInputElement | undefined;
  const [editorIdentity, setEditorIdentity] = createSignal<string | null>(null);
  const [error, setError] = createSignal("");
  const [preview, setPreview] = createSignal<{
    id: string;
    included: string[];
    excluded: string[];
  } | null>(null);

  const visibleEditorIdentity = () =>
    editorIdentity() ?? (server.matrices().length === 0 ? NEW_ENVIRONMENT : null);

  function matrixForIdentity(identity: string): CompatibilityMatrix | undefined {
    if (identity === NEW_ENVIRONMENT) return undefined;
    return server.matrices().find((matrix) => matrix.id === identity);
  }

  async function previewMatrix(id: string): Promise<void> {
    setError("");
    try {
      const expansion = await server.resolveCompatibilityMatrix(id);
      setPreview({
        id,
        included: expansion.profiles.map((profile) => profile.name),
        excluded: expansion.excluded.map((item) => `${item.profile.name}: ${item.reason}`),
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not preview these devices.");
    }
  }

  async function downloadMatrixYaml(id: string): Promise<void> {
    setError("");
    try {
      const yaml = await server.loadCompatibilityMatrixYaml(id);
      if (!yaml) throw new Error("This environment could not be exported.");
      const url = URL.createObjectURL(new Blob([yaml], { type: "application/yaml" }));
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${id}.relay.matrix.yaml`;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not export this environment.");
    }
  }

  async function importMatrixYaml(event: Event): Promise<void> {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    setError("");
    try {
      await server.importCompatibilityMatrixYaml(await file.text());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not import this YAML file.");
    }
  }

  return (
    <section class="flex flex-col gap-4">
      <header class="flex items-start justify-between gap-4">
        <div class="min-w-0">
          <h3 class="m-0 text-14-medium text-text-strong">Test environments</h3>
          <p class="mt-1 mb-0 max-w-[34rem] text-12-regular leading-relaxed text-text-weak">
            A reusable set of devices. Choose an environment when you run a test to repeat it on
            every device in the set.
          </p>
        </div>
        <div class="flex shrink-0 items-center gap-1.5">
          <input
            ref={(element) => (matrixFileInput = element)}
            class="sr-only"
            type="file"
            accept=".yaml,.yml,text/yaml,application/yaml"
            onChange={(event) => void importMatrixYaml(event)}
          />
          <Button variant="ghost" size="sm" onClick={() => matrixFileInput?.click()}>
            Import…
          </Button>
          <Show when={!visibleEditorIdentity()}>
            <Button variant="primary" size="sm" onClick={() => setEditorIdentity(NEW_ENVIRONMENT)}>
              New environment
            </Button>
          </Show>
        </div>
      </header>

      <Show when={error()}>
        <p
          class="m-0 rounded-md bg-surface-critical-weak px-3 py-2 text-11-regular text-icon-critical-base"
          role="alert"
        >
          {error()}
        </p>
      </Show>

      <Show when={visibleEditorIdentity()} keyed>
        {(identity) => (
          <TestEnvironmentEditor
            matrix={matrixForIdentity(identity)}
            canClose={server.matrices().length > 0}
            onClose={() => setEditorIdentity(null)}
          />
        )}
      </Show>

      <div class="flex flex-col gap-2">
        <For each={server.matrices()}>
          {(matrix) => (
            <div class="rounded-lg border border-border-weak-base bg-background-base p-3">
              <div class="flex items-center justify-between gap-3">
                <div class="min-w-0">
                  <strong class="block truncate text-12-medium text-text-strong">
                    {matrix.name}
                  </strong>
                  <span class="mt-0.5 block truncate text-11-regular text-text-weak">
                    {matrixSummary(matrix)}
                  </span>
                </div>
                <div class="flex shrink-0 gap-1.5">
                  <Button variant="ghost" size="sm" onClick={() => setEditorIdentity(matrix.id)}>
                    Edit
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => void previewMatrix(matrix.id)}>
                    Preview devices
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => void downloadMatrixYaml(matrix.id)}
                  >
                    Export YAML
                  </Button>
                  <IconButton
                    variant="ghost"
                    size="normal"
                    aria-label={`Delete ${matrix.name}`}
                    onClick={() => void server.deleteCompatibilityMatrix(matrix.id)}
                  >
                    <Icon name="trash" size={14} />
                  </IconButton>
                </div>
              </div>
              <Show when={preview()?.id === matrix.id}>
                <p class="mt-2 mb-0 text-11-regular leading-relaxed text-text-weak" role="status">
                  Includes: {preview()!.included.join(", ") || "none"}.
                  <Show when={preview()!.excluded.length > 0}>
                    {" "}
                    Excluded: {preview()!.excluded.join("; ")}.
                  </Show>
                </p>
              </Show>
            </div>
          )}
        </For>
      </div>
    </section>
  );
}

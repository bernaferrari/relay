/** @jsxImportSource react */
import { useId, type ReactNode } from "react";
import { Button } from "@relay/ui-react/components/button";
import { Checkbox } from "@relay/ui-react/components/checkbox";
import { FieldLabel } from "@relay/ui-react/components/field";
import { SelectField } from "./filter-select";
import type {
  RunConfigurationBlocker,
  RunConfigurationOption,
  RunConfigurationSelection,
  RunConfigurationState,
} from "../data/run-configuration";

export function runConfigurationReady(configuration: RunConfigurationState): boolean {
  return (configuration.blockers?.length ?? 0) === 0 && configuration.validated === true;
}

export function RunConfigurationComposer({
  configuration,
  onResolveBlocker,
  targetOptions,
  dataSetOptions,
  selection,
  onSelectionChange,
  multipleTargets = false,
  loading = false,
  error,
  onRetry,
  children,
  variant = "panel",
  title,
  pairedWorkspaceLabel,
}: {
  configuration: RunConfigurationState;
  onResolveBlocker?: (blocker: RunConfigurationBlocker) => void;
  targetOptions?: readonly RunConfigurationOption[];
  dataSetOptions?: readonly RunConfigurationOption[];
  selection?: RunConfigurationSelection;
  onSelectionChange?: (selection: RunConfigurationSelection) => void;
  multipleTargets?: boolean;
  loading?: boolean;
  error?: string;
  onRetry?: () => void;
  children?: ReactNode;
  targetGroupName?: string;
  variant?: "panel" | "plain";
  title?: ReactNode;
  pairedWorkspaceLabel?: string;
}) {
  const titleId = useId();
  const selectedTargets =
    selection?.targetProfileIds ?? (selection?.targetProfileId ? [selection.targetProfileId] : []);
  const facts = [
    ["Revision", configuration.values.sourceRevision],
    ["Build", configuration.values.buildId],
    ["Target", configuration.values.targetName ?? configuration.values.targetProfileId],
    ["Account", configuration.values.accountName ?? configuration.values.accountId],
    ["Browser", configuration.values.browserProfile],
    ["Data set", configuration.values.dataSetName ?? configuration.values.dataSetId],
  ];
  function toggleTarget(id: string, checked: boolean) {
    const next = new Set(selectedTargets);
    if (checked) next.add(id);
    else next.delete(id);
    onSelectionChange?.({
      ...selection,
      targetProfileId: [...next][0],
      targetProfileIds: [...next],
    });
  }
  const optionCopy = (option: RunConfigurationOption) => (
    <span className="relay-config-option-copy grid min-w-0 flex-1 gap-[3px] wrap-anywhere [&_strong]:text-[13px] [&_strong]:font-medium [&_small]:text-xs [&_small]:text-muted-foreground">
      <strong data-slot="run-target-title">{option.label}</strong>
      {option.detail ? <small>{option.detail}</small> : null}
    </span>
  );
  return (
    <section
      aria-label="Run configuration"
      className={`relay-run-configuration grid min-w-0 gap-3 ${variant === "panel" ? "rounded-xl border border-border bg-card p-5" : ""}`}
    >
      <h2 id={titleId} className="text-[13px] font-medium text-muted-foreground">
        {title ?? (configuration.frozen ? "Recorded configuration" : "Run on")}
      </h2>
      {configuration.frozen ? (
        <dl className="relay-config-facts m-0 grid grid-cols-[repeat(auto-fit,minmax(140px,1fr))] gap-4 [&_dt]:text-xs [&_dt]:text-muted-foreground [&_dd]:mt-1 [&_dd]:text-[13px] [&_dd]:wrap-anywhere">
          {facts.map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value ?? "Not recorded"}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {error ? (
        <div
          role="alert"
          className="m-0 rounded-lg border border-border p-3 text-[13px] [&_p]:mt-1 [&_p]:mb-2"
        >
          <p>{error}</p>
          {onRetry ? (
            <Button variant="outline" size="sm" onClick={onRetry}>
              Try again
            </Button>
          ) : null}
        </div>
      ) : null}
      {targetOptions && onSelectionChange ? (
        <>
          {multipleTargets ? (
            <fieldset
              disabled={loading}
              className="relay-config-options grid min-w-0 gap-2 border-0 p-0 [&_legend]:mb-2.5 [&_legend]:text-[13px] [&_legend]:font-semibold"
            >
              <legend>Where to run</legend>
              {targetOptions.map((option) => (
                <FieldLabel
                  key={option.id}
                  className="relay-config-option flex min-h-11 w-full min-w-0 cursor-pointer items-center gap-3 border-b border-border py-2.5 has-data-checked:[&_[data-slot=run-target-title]]:text-foreground last:border-b-0"
                >
                  {optionCopy(option)}
                  <Checkbox
                    checked={selectedTargets.includes(option.id)}
                    onCheckedChange={(checked) => toggleTarget(option.id, checked === true)}
                  />
                </FieldLabel>
              ))}
            </fieldset>
          ) : (
            <SelectField
              label="Device or browser"
              value={selection?.targetProfileId ?? ""}
              options={targetOptions.map((option) => ({ value: option.id, label: option.label }))}
              placeholder="Choose a device"
              onValueChange={(targetProfileId) =>
                onSelectionChange({ ...selection, targetProfileId, targetProfileIds: undefined })
              }
              disabled={loading}
            />
          )}
        </>
      ) : null}
      {dataSetOptions && onSelectionChange ? (
        <fieldset
          disabled={loading}
          className="relay-config-options grid min-w-0 gap-2 border-0 p-0 [&_legend]:mb-2.5 [&_legend]:text-[13px] [&_legend]:font-semibold"
        >
          <legend>Data set values</legend>
          {dataSetOptions.map((option) => (
            <FieldLabel
              key={option.id}
              className="relay-config-option flex min-h-12 w-full min-w-0 cursor-pointer items-center gap-3 rounded-lg border border-border p-3 has-data-checked:border-ring has-data-checked:bg-accent"
            >
              {optionCopy(option)}
              <Checkbox
                checked={selection?.dataSetIds?.includes(option.id) ?? false}
                onCheckedChange={(checked) => {
                  const next = new Set(selection?.dataSetIds ?? []);
                  if (checked === true) next.add(option.id);
                  else next.delete(option.id);
                  onSelectionChange({ ...selection, dataSetIds: [...next] });
                }}
              />
            </FieldLabel>
          ))}
        </fieldset>
      ) : null}
      {configuration.blockers?.length ? (
        <div
          className="m-0 rounded-lg border border-border p-3 text-[13px] [&_p]:mt-1 [&_p]:mb-2"
          role="alert"
        >
          <ul>
            {configuration.blockers.map((blocker) => (
              <li key={blocker.id}>
                <strong>{blocker.label}</strong>
                {blocker.detail ? <p>{blocker.detail}</p> : null}
                {onResolveBlocker ? (
                  <Button variant="outline" size="sm" onClick={() => onResolveBlocker(blocker)}>
                    Resolve {blocker.label.toLowerCase()}
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {pairedWorkspaceLabel && onSelectionChange ? (
        <label className="flex min-h-11 items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={selection?.usePairedWorkspace === true}
            onChange={(event) =>
              onSelectionChange({
                ...selection,
                usePairedWorkspace: event.currentTarget.checked || undefined,
              })
            }
          />
          {pairedWorkspaceLabel}
        </label>
      ) : null}
      {children}
    </section>
  );
}

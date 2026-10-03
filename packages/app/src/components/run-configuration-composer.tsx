import { RunTargetPicker } from "./run-target-picker";
/** @jsxImportSource react */
import { useId, useState, type ReactNode } from "react";
import { Languages } from "lucide-react";
import { languagePresentation } from "../data/language-presentation";
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
  pairedWorkspaceAction,
  targetLabel = "Device or browser",
  targetPlaceholder = "Choose a device or browser",
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
  pairedWorkspaceAction?: ReactNode;
  targetLabel?: string;
  targetPlaceholder?: string;
}) {
  const titleId = useId();
  const languageChoices = Boolean(
    dataSetOptions?.length && dataSetOptions.every((option) => option.locale),
  );
  const [valueSearch, setValueSearch] = useState("");
  const filteredValues = dataSetOptions?.filter((option) =>
    `${option.label} ${option.detail ?? ""}`
      .toLocaleLowerCase()
      .includes(valueSearch.toLocaleLowerCase().trim()),
  );
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
    <span className="grid min-w-0 flex-1 gap-0.5 wrap-anywhere [&_strong]:text-sm [&_strong]:font-medium [&_small]:text-xs [&_small]:text-foreground">
      <strong data-slot="run-target-title" className="flex items-center gap-2">
        {option.locale ? (
          <span
            aria-hidden="true"
            className="flex size-5 shrink-0 items-center justify-center text-base"
          >
            {languagePresentation(option.locale, option.label).flag ?? (
              <Languages className="size-4 text-muted-foreground" />
            )}
          </span>
        ) : null}
        {option.locale ? languagePresentation(option.locale, option.label).label : option.label}
      </strong>
      {option.detail ? <small>{option.detail}</small> : null}
    </span>
  );
  return (
    <section
      aria-label="Run configuration"
      className={`grid min-w-0 gap-3 ${variant === "panel" ? "rounded-xl border border-border bg-card p-5" : ""}`}
    >
      {title !== null ? (
        <h2 id={titleId} className="text-sm font-medium text-muted-foreground">
          {title ?? (configuration.frozen ? "Recorded configuration" : "Run on")}
        </h2>
      ) : null}
      {configuration.frozen ? (
        <dl className="m-0 grid grid-cols-[repeat(auto-fit,minmax(140px,1fr))] gap-4 [&_dt]:text-xs [&_dt]:text-muted-foreground [&_dd]:mt-1 [&_dd]:text-sm [&_dd]:wrap-anywhere">
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
          className="m-0 rounded-lg border border-border p-3 text-sm [&_p]:mt-1 [&_p]:mb-2"
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
            <RunTargetPicker
              options={targetOptions}
              selected={selectedTargets}
              disabled={loading}
              onToggle={toggleTarget}
            />
          ) : (
            <div className="grid gap-2">
              <SelectField
                label={targetLabel}
                value={selection?.targetProfileId ?? ""}
                options={targetOptions.map((option) => ({ value: option.id, label: option.label }))}
                placeholder={
                  targetOptions.length ? targetPlaceholder : "No devices or browsers available"
                }
                onValueChange={(targetProfileId) =>
                  onSelectionChange({ ...selection, targetProfileId, targetProfileIds: undefined })
                }
                disabled={loading}
              />
              {targetOptions.find((option) => option.id === selection?.targetProfileId)?.detail ? (
                <p className="text-sm text-muted-foreground" role="status">
                  {targetOptions.find((option) => option.id === selection?.targetProfileId)?.detail}
                </p>
              ) : null}
            </div>
          )}
        </>
      ) : null}
      {pairedWorkspaceLabel && onSelectionChange ? (
        <div className="flex flex-wrap items-center justify-between gap-x-3 text-sm">
          <label className="flex min-h-11 items-center gap-2">
            <Checkbox
              disabled={loading}
              checked={selection?.usePairedWorkspace === true}
              onCheckedChange={(checked) =>
                onSelectionChange({
                  ...selection,
                  usePairedWorkspace: checked === true || undefined,
                })
              }
            />
            {pairedWorkspaceLabel}
          </label>
          {pairedWorkspaceAction}
        </div>
      ) : null}
      {dataSetOptions && onSelectionChange ? (
        <fieldset
          disabled={loading}
          className="grid min-w-0 gap-2 border-0 p-0 [&_legend]:mb-1.5 [&_legend]:text-sm [&_legend]:font-semibold"
        >
          <legend className="w-full">
            <span className="flex items-center justify-between gap-3">
              <span>
                {languageChoices ? "Languages" : "Data set values"}
                <span className="ml-2 text-xs font-normal text-muted-foreground">
                  {selection?.dataSetIds?.length ?? 0} selected
                </span>
              </span>
              <button
                type="button"
                className="relative rounded px-1 text-xs after:absolute after:-inset-y-1 after:inset-x-0 font-normal text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50"
                disabled={!filteredValues?.length}
                onClick={() => {
                  const matchingIds = (filteredValues ?? []).map((option) => option.id);
                  const chosen = new Set(selection?.dataSetIds ?? []);
                  const allSelected = matchingIds.every((id) => chosen.has(id));
                  matchingIds.forEach((id) => (allSelected ? chosen.delete(id) : chosen.add(id)));
                  onSelectionChange({ ...selection, dataSetIds: [...chosen] });
                }}
              >
                {filteredValues?.length &&
                filteredValues.every((option) => selection?.dataSetIds?.includes(option.id))
                  ? "Clear"
                  : valueSearch.trim()
                    ? "Select matches"
                    : "Select all"}
              </button>
            </span>
          </legend>
          <input
            aria-label={languageChoices ? "Search languages" : "Search values"}
            placeholder={languageChoices ? "Search languages…" : "Search values…"}
            value={valueSearch}
            onChange={(event) => setValueSearch(event.target.value)}
            className="h-11 w-full rounded-md border border-input bg-background px-3 text-base sm:text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <div
            className="max-h-[42dvh] min-h-0 overflow-y-auto overscroll-contain"
            role="region"
            aria-label="Available values"
            tabIndex={0}
          >
            <div className="grid grid-cols-1 content-start gap-1 pr-3 sm:grid-cols-2">
              {filteredValues?.map((option) => (
                <FieldLabel
                  key={option.id}
                  className="flex min-h-11 w-full min-w-0 cursor-pointer items-center gap-3 rounded-md px-3 py-2 transition-colors hover:bg-accent has-data-checked:bg-accent"
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
              {!filteredValues?.length ? (
                <p className="p-3 text-sm text-muted-foreground">No matching values.</p>
              ) : null}
            </div>
          </div>
        </fieldset>
      ) : null}
      {configuration.blockers?.length ? (
        <div
          className="m-0 rounded-lg border border-border p-3 text-sm [&_p]:mt-1 [&_p]:mb-2"
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
      {children}
    </section>
  );
}

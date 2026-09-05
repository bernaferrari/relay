/** @jsxImportSource react */
import { useId, type ReactNode } from "react";
import { Button } from "@relay/ui-react/components/button";
import { Checkbox } from "@relay/ui-react/components/checkbox";
import { FieldLabel } from "@relay/ui-react/components/field";
import { RadioGroup, RadioGroupItem } from "@relay/ui-react/components/radio-group";
import type { RunConfigurationBlocker, RunConfigurationOption, RunConfigurationSelection, RunConfigurationState } from "../data/run-configuration";

export function runConfigurationReady(configuration: RunConfigurationState): boolean {
  return (configuration.blockers?.length ?? 0) === 0 && configuration.validated === true;
}

export function RunConfigurationComposer({ configuration, onResolveBlocker, targetOptions, dataSetOptions, selection, onSelectionChange, multipleTargets = false, loading = false, error, onRetry, children, targetGroupName = "run-target" }: {
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
}) {
  const titleId = useId();
  const selectedTargets = selection?.targetProfileIds ?? (selection?.targetProfileId ? [selection.targetProfileId] : []);
  const facts = [["Revision", configuration.values.sourceRevision], ["Build", configuration.values.buildId], ["Target", configuration.values.targetName ?? configuration.values.targetProfileId], ["Account", configuration.values.accountName ?? configuration.values.accountId], ["Browser", configuration.values.browserProfile], ["Data set", configuration.values.dataSetName ?? configuration.values.dataSetId]];
  function toggleTarget(id: string, checked: boolean) {
    const next = new Set(selectedTargets);
    if (checked) next.add(id); else next.delete(id);
    onSelectionChange?.({ ...selection, targetProfileId: [...next][0], targetProfileIds: [...next] });
  }
  const optionCopy = (option: RunConfigurationOption) => <span className="relay-config-option-copy"><strong>{option.label}</strong>{option.detail ? <small>{option.detail}</small> : null}</span>;
  return <section aria-label="Run configuration" className="relay-run-configuration">
    <div className="relay-section-heading">
      <h2 id={titleId}>{configuration.frozen ? "Recorded configuration" : "Run configuration"}</h2>
      {!configuration.frozen ? <span role="status">{loading ? "Restoring choices…" : runConfigurationReady(configuration) ? "Ready" : "Needs setup"}</span> : null}
    </div>
    {configuration.frozen ? <dl className="relay-config-facts">{facts.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value ?? "Not recorded"}</dd></div>)}</dl> : null}
    {error ? <div role="alert" className="relay-config-problem"><p>{error}</p>{onRetry ? <Button variant="outline" size="sm" onClick={onRetry}>Try again</Button> : null}</div> : null}
    {targetOptions && onSelectionChange ? <>
      {multipleTargets ? <fieldset disabled={loading} className="relay-config-options"><legend>Environments</legend>{targetOptions.map((option) => <FieldLabel key={option.id} className="relay-config-option">{optionCopy(option)}<Checkbox checked={selectedTargets.includes(option.id)} onCheckedChange={(checked) => toggleTarget(option.id, checked === true)} /></FieldLabel>)}</fieldset> : <RadioGroup className="relay-config-options" name={targetGroupName} value={selection?.targetProfileId ?? ""} onValueChange={(targetProfileId) => onSelectionChange({ ...selection, targetProfileId, targetProfileIds: undefined })} disabled={loading} aria-label="Device or browser">{targetOptions.map((option) => <FieldLabel key={option.id} className="relay-config-option"><RadioGroupItem value={option.id} />{optionCopy(option)}</FieldLabel>)}</RadioGroup>}
    </> : null}
    {dataSetOptions && onSelectionChange ? <fieldset disabled={loading} className="relay-config-options"><legend>Data set values</legend>{dataSetOptions.map((option) => <FieldLabel key={option.id} className="relay-config-option">{optionCopy(option)}<Checkbox checked={selection?.dataSetIds?.includes(option.id) ?? false} onCheckedChange={(checked) => { const next = new Set(selection?.dataSetIds ?? []); if (checked === true) next.add(option.id); else next.delete(option.id); onSelectionChange({ ...selection, dataSetIds: [...next] }); }} /></FieldLabel>)}</fieldset> : null}
    {configuration.blockers?.length ? <ul className="relay-config-problem" role="alert">{configuration.blockers.map((blocker) => <li key={blocker.id}><strong>{blocker.label}</strong>{blocker.detail ? <p>{blocker.detail}</p> : null}{onResolveBlocker ? <Button variant="outline" size="sm" onClick={() => onResolveBlocker(blocker)}>Resolve {blocker.label.toLowerCase()}</Button> : null}</li>)}</ul> : null}
    {children}
  </section>;
}

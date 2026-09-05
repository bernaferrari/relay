/** @jsxImportSource react */
import { useMemo } from "react";
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
}: {
  configuration: RunConfigurationState;
  onResolveBlocker?: (blocker: RunConfigurationBlocker) => void;
  targetOptions?: readonly RunConfigurationOption[];
  dataSetOptions?: readonly RunConfigurationOption[];
  selection?: RunConfigurationSelection;
  onSelectionChange?: (selection: RunConfigurationSelection) => void;
}) {
  const facts = useMemo(() => {
    const values = configuration.values;
    return [
      ["Revision", values.sourceRevision],
      ["Build", values.buildId],
      ["Target", values.targetName ?? values.targetProfileId],
      ["Account", values.accountName ?? values.accountId],
      ["Browser", values.browserProfile],
      ["Data set", values.dataSetName ?? values.dataSetId],
    ] as const;
  }, [configuration.values]);
  return (
    <section aria-label="Run configuration" className="relay-run-configuration">
      <div className="relay-section-heading">
        <div>
          <p className="relay-section-label">Execution configuration</p>
          <h2>{configuration.frozen ? "Recorded configuration" : "Run configuration"}</h2>
        </div>
        <span>{runConfigurationReady(configuration) ? "Ready" : "Needs setup"}</span>
      </div>
      <dl>
        {facts.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value ?? "Not recorded"}</dd>
          </div>
        ))}
      </dl>
      {targetOptions?.length && onSelectionChange ? (
        <label>
          <span>Target</span>
          <select
            value={selection?.targetProfileId ?? ""}
            onChange={(event) =>
              onSelectionChange({
                ...selection,
                targetProfileId: event.currentTarget.value || undefined,
              })
            }
          >
            <option value="">Choose a target</option>
            {targetOptions.map((option) => (
              <option value={option.id} key={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {dataSetOptions?.length && onSelectionChange ? (
        <fieldset>
          <legend>Data set values</legend>
          {dataSetOptions.map((option) => (
            <label key={option.id}>
              <input
                type="checkbox"
                checked={selection?.dataSetIds?.includes(option.id) ?? false}
                onChange={(event) => {
                  const current = new Set(selection?.dataSetIds ?? []);
                  if (event.currentTarget.checked) current.add(option.id);
                  else current.delete(option.id);
                  onSelectionChange({ ...selection, dataSetIds: [...current] });
                }}
              />
              {option.label}
            </label>
          ))}
        </fieldset>
      ) : null}
      {configuration.blockers?.length ? (
        <ul role="alert">
          {configuration.blockers.map((blocker) => (
            <li key={blocker.id}>
              <strong>{blocker.label}</strong>
              {blocker.detail ? ` — ${blocker.detail}` : ""}
              {onResolveBlocker ? (
                <button type="button" onClick={() => onResolveBlocker(blocker)}>
                  Resolve
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

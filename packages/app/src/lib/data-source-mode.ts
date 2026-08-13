export type DataSourceMode = "AI" | "List" | "Default";
export type DataValueScope = "shared" | "private";

export type DataSourceSelection = {
  scope: DataValueScope;
  mode: DataSourceMode;
  sharedMode?: DataSourceMode;
};

export const dataSourceModeOptions: readonly {
  value: DataSourceMode;
  label: string;
}[] = [
  { value: "Default", label: "Fixed value" },
  { value: "List", label: "Choose from a list" },
  { value: "AI", label: "Generate with AI" },
];

export function dataSourceScopePatch(
  current: DataSourceSelection,
  scope: DataValueScope,
): DataSourceSelection {
  if (scope === "private") {
    return {
      scope,
      mode: "Default",
      sharedMode: current.scope === "shared" ? current.mode : current.sharedMode,
    };
  }
  return {
    scope,
    mode: current.sharedMode ?? current.mode,
    sharedMode: current.sharedMode,
  };
}

export function dataSourceModePatch(
  mode: DataSourceMode,
): Pick<DataSourceSelection, "mode" | "sharedMode"> {
  return { mode, sharedMode: mode };
}

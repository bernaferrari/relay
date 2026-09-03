import type { AppMap, AppMapVariable } from "@relay/protocol";
export type PublicLanguage = { id: string; label: string; code?: string; selected: boolean };
export type LanguageViewModel = { id: string; name: string; values: readonly PublicLanguage[] };
export function languageViewModel(variable: AppMapVariable): LanguageViewModel | undefined {
  if (variable.kind !== "language") return undefined;
  return {
    id: variable.id,
    name: variable.name,
    values: variable.options.map((row) => ({
      id: row.id,
      label: row.label ?? row.text ?? row.identifier ?? row.id,
      selected: false,
    })),
  };
}
export function appLanguages(app: AppMap): readonly LanguageViewModel[] {
  return Object.values(app.variables).flatMap((variable) => {
    const model = languageViewModel(variable);
    return model ? [model] : [];
  });
}

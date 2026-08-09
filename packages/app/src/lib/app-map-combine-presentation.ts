/** User-facing data-run model: Variable (list) × Test (what you run). */

export type CombineValue = {
  id: string;
  label: string;
};

export type CombineTestColumn = {
  id: string;
  name: string;
  kind: "path" | "tour";
};

export type CombineCell = {
  valueId: string;
  testId: string;
  valueLabel: string;
  testName: string;
};

export function combineValueLabel(option: { id: string; label?: string; text?: string }): string {
  const label = option.label?.trim() || option.text?.trim() || option.id.trim();
  return label || option.id;
}

export function combineHeadline(input: {
  variableName?: string;
  testName?: string;
  cellCount: number;
}): string {
  const variable = input.variableName?.trim();
  const test = input.testName?.trim();
  if (variable && test && input.cellCount > 1) return `${variable} × ${test}`;
  if (test) return test;
  if (variable) return variable;
  return "Run with data";
}

export function combineSubhead(input: {
  cellCount: number;
  hasVariable: boolean;
  hasTest: boolean;
}): string {
  if (!input.hasTest) return "Record a path on the map before adding data.";
  if (!input.hasVariable) {
    return "Add a list such as languages, accounts, or models to repeat this path.";
  }
  if (input.cellCount <= 1) return "One value selected. Run it, or select more values.";
  return `${input.cellCount} runs. Start one run, or run the full set.`;
}

export function combineCells(values: CombineValue[], tests: CombineTestColumn[]): CombineCell[] {
  const cells: CombineCell[] = [];
  for (const value of values) {
    for (const test of tests) {
      cells.push({
        valueId: value.id,
        testId: test.id,
        valueLabel: value.label,
        testName: test.name,
      });
    }
  }
  return cells;
}

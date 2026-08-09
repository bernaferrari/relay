import type { AppMap } from "@relay/protocol";
import { combineHeadline, combineValueLabel } from "./app-map-combine-presentation";
import { SCREEN_CARD_WIDTH } from "./app-map-canvas-layout";

export type CanvasCombineCardModel = {
  id: string;
  name: string;
  position: { x: number; y: number };
  values: string[];
  tests: string[];
  cellCount: number;
};

const CARD_GAP = 28;
const CARD_STACK = 156;
const PREVIEW_VALUES = 6;

export function canvasCombineCards(
  map: Pick<AppMap, "combines" | "tests" | "variables" | "flows">,
  positionFor: (screenId: string) => { x: number; y: number } | undefined,
): CanvasCombineCardModel[] {
  const combines = Object.values(map.combines ?? {});
  return combines.map((combine, index) => {
    const tests = combine.testIds
      .map((id) => map.tests?.[id])
      .filter((test): test is NonNullable<typeof test> => Boolean(test));
    const variables = combine.variableIds
      .map((id) => map.variables?.[id])
      .filter((variable): variable is NonNullable<typeof variable> => Boolean(variable));
    const rootScreenId =
      tests.find((test) => test.rootScreenId?.trim())?.rootScreenId ??
      tests
        .map((test) => (test.flowId ? map.flows?.[test.flowId]?.startScreenId : undefined))
        .find((id) => id?.trim());
    const anchor = rootScreenId ? positionFor(rootScreenId) : undefined;
    const values = variables
      .flatMap((variable) => variable.options.map((option) => combineValueLabel(option)))
      .filter(Boolean)
      .slice(0, PREVIEW_VALUES);
    const testNames = tests.map((test) => test.name).filter(Boolean);
    const cellCount = Math.max(values.length, 1) * Math.max(testNames.length, 1);
    return {
      id: combine.id,
      name: combineHeadline({
        variableName: variables[0]?.name,
        testName: testNames[0],
        cellCount,
      }),
      position: {
        x: (anchor?.x ?? 48) + SCREEN_CARD_WIDTH + CARD_GAP,
        y: (anchor?.y ?? 48) + index * CARD_STACK,
      },
      values,
      tests: testNames,
      cellCount: values.length && testNames.length ? values.length * testNames.length : cellCount,
    };
  });
}

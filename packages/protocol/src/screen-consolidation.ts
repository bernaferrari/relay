export type ScreenConsolidationPreview = {
  targetScreenId: string;
  sourceScreenIds: string[];
  movedVariantIds: string[];
  mergedVariantIds: Array<{ sourceVariantId: string; targetVariantId: string }>;
  rewiredConnectionIds: string[];
  removedSelfLoopConnectionIds: string[];
  connectionCollisions: Array<{ connectionIds: string[] }>;
  rewiredFlowIds: string[];
  rewiredTestIds: string[];
  rewiredVariableIds: string[];
  rewiredGroupIds: string[];
  semanticRevealConnectionIds: string[];
  testPathEdits: Array<{
    testId: string;
    stepId: string;
    beforeConnectionIds: string[];
    afterConnectionIds: string[];
  }>;
  removedTestStepIds: string[];
  renamedTestSteps: Array<{
    testId: string;
    stepId: string;
    beforeIntent: string;
    afterIntent: string;
  }>;
  resultingCounts: {
    screens: number;
    variants: number;
    connections: number;
    surfaceBindings: number;
    testSteps: number;
  };
  blockers: Array<{ code: string; message: string; entityIds: string[] }>;
};

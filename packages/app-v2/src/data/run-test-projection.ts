import type { ProductTestStep } from "@relay/product/catalog";

export type ProductTestSummary = {
  id: string;
  name: string;
  appMapId: string;
  appName: string;
  stepCount: number;
  steps?: readonly ProductTestStep[];
};

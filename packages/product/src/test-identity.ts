import type { AppMap, AppMapTest } from "@relay/protocol";

export type ProductTestOwner = {
  app: AppMap;
  test: AppMapTest;
};

export class ProductTestIdentityAmbiguityError extends Error {
  readonly code = "product-test-identity-ambiguous";
  readonly appMapIds: readonly string[];

  constructor(testId: string, appMapIds: readonly string[]) {
    super(
      `Relay found more than one saved test with the identity ${testId}. Open the test from its app and try again.`,
    );
    this.name = "ProductTestIdentityAmbiguityError";
    this.appMapIds = [...appMapIds];
  }
}

export function findUniqueProductTestOwner(
  appMaps: readonly AppMap[],
  testId: string,
): ProductTestOwner | undefined {
  const matches = appMaps.flatMap((app) => {
    const test = app.tests[testId];
    return test ? [{ app, test }] : [];
  });

  if (matches.length > 1) {
    throw new ProductTestIdentityAmbiguityError(
      testId,
      matches.map(({ app }) => app.id),
    );
  }

  return matches[0];
}

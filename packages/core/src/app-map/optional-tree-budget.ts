/** Follow-on accessibility reads stay off the pixel slot. Fast/Sequence
 * review and automatic tap evidence share this ceiling so a hung tree cannot
 * stall the image. Stable / expect-screen still use the ordinary snapshot
 * budget when they need identity. */
export const OPTIONAL_TREE_BUDGET_MS = 500;

export async function withOptionalTreeBudget<T>(
  budgetMs: number | undefined,
  work: () => Promise<T>,
): Promise<T> {
  if (budgetMs === undefined) return work();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work(),
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error(`optional accessibility snapshot exceeded ${budgetMs}ms`));
        }, budgetMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

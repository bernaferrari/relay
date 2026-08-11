/**
 * Read an optional finite number without turning a missing query parameter
 * into zero (`Number(null) === 0`). This matters for coordinate parameters:
 * an absent preview point must not silently become the top-left corner.
 */
export function optionalFiniteSearchNumber(
  searchParams: URLSearchParams,
  name: string,
): number | undefined {
  const raw = searchParams.get(name);
  if (raw === null || raw.trim() === "") return undefined;
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

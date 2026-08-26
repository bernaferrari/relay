/**
 * The shelf half of the tidy layout: which of a parent's branches are packed
 * side by side instead of spending a row each, and how wide that block grows
 * before it wraps.
 *
 * A branch whose whole subtree already fits on one row — a screen that opens
 * nothing, or a short chain that never forks — has no height of its own to
 * reserve, so a wide fan of them spends one nearly empty row each. That is what
 * turns a path into a ribbon. Kept apart from placement because the width a
 * shelf wraps at is a decision about the whole map's shape, not about where any
 * one card goes.
 */

/** One row band of a parent's children: either a branch that reserves the whole
 * height of its own subtree, or a shelf of one-row branches wrapped side by
 * side. */
export type SiblingGroup = { kind: "branch"; id: string } | { kind: "shelf"; rows: string[][] };

/** How many columns a child reserves on a shelf, or nothing when its subtree is
 * too tall or too wide to belong on one. */
export type ShelfWidth = (id: string) => number | undefined;

/** Air between shelf rows. Edges to the later columns of a shelf arrive along
 * this corridor rather than through a card, so it is wider than the gap two
 * plain sibling branches need. */
export const SHELF_ROW_GAP_ROWS = 0.35;

/**
 * How many one-row branches a single screen has to open before they are packed
 * side by side instead of spending a row each.
 *
 * Three, which is to say: whenever a row is unambiguously a row. A row of
 * siblings is told apart from a chain by where its edges arrive — the second
 * and later cards are reached along the corridor above the row, not through the
 * card to their left — so the shape does not have to carry that on its own. The
 * map is read on a canvas about twice as wide as it is tall; a fan is the only
 * place this layout chooses between rows and columns, so it is the place that
 * choice has to be spent. A fan of two is the one size that has to be asked
 * about separately, because it is the size the branch optimizer works on.
 */
const MIN_SHELF_ITEMS = 3;

/**
 * Group a parent's children into the bands they lay out in.
 *
 * Once a fan opens enough one-row branches they wrap into a shelf, the way
 * words wrap into lines: consecutive runs only, filled left to right, so the
 * order the actions were recorded in stays exactly the order the shelf reads
 * in. Anything that owns real height keeps its own rows.
 */
export function siblingLayoutGroups(
  childIds: readonly string[],
  shelfWidth: ShelfWidth,
  shelfColumns: number,
): SiblingGroup[] {
  const groups: SiblingGroup[] = [];
  let run: string[] = [];
  const flushRun = () => {
    if (run.length >= MIN_SHELF_ITEMS || packsAsPair(run, shelfWidth)) {
      groups.push({ kind: "shelf", rows: shelfRows(run, shelfWidth, shelfColumns) });
    } else groups.push(...run.map((id) => ({ kind: "branch" as const, id })));
    run = [];
  };
  for (const id of childIds) {
    if (shelfWidth(id) !== undefined) {
      run.push(id);
      continue;
    }
    flushRun();
    groups.push({ kind: "branch", id });
  }
  flushRun();
  return groups;
}

/**
 * Whether a fan of exactly two packs side by side instead of spending a row
 * each.
 *
 * A pair is the commonest shape in a map, and it is the shape the local branch
 * optimizer works on: it removes a crossing by promoting one of a parent's
 * branches onto the parent's own row, and packing puts both of them there, so
 * there is no primary row left to win and a cross-link the promotion would have
 * removed simply stays. Packing every pair buys the width of the two largest
 * crawls by switching that off everywhere.
 *
 * But there is only a choice to give up when both sides continue. A branch that
 * opens nothing carries nothing onto the row it would be promoted to, so
 * promoting it was never the move that removes anything. So a pair packs when
 * one of its two sides is a dead end, and two continuing journeys keep a row
 * each — which is also the pair that reads worst packed, since a single card
 * beside a longer chain is plainly a row, while two chains starting side by
 * side leave the corridor doing all the work of saying so.
 */
function packsAsPair(run: readonly string[], shelfWidth: ShelfWidth): boolean {
  return run.length === 2 && run.some((id) => shelfWidth(id) === 1);
}

/**
 * Wrap a run of one-row branches into rows no wider than the given number of
 * columns. The rows are balanced rather than each filled to the brim, so a
 * block never ends in one lonely card.
 */
function shelfRows(
  ids: readonly string[],
  shelfWidth: ShelfWidth,
  shelfColumns: number,
): string[][] {
  const widthOf = (id: string) => shelfWidth(id) ?? 1;
  const widthFrom = (index: number) => ids.slice(index).reduce((sum, id) => sum + widthOf(id), 0);
  const rowCount = Math.max(1, Math.ceil(widthFrom(0) / shelfColumns));
  const rows: string[][] = [];
  let index = 0;
  while (index < ids.length) {
    const target = Math.min(
      shelfColumns,
      Math.max(1, Math.ceil(widthFrom(index) / Math.max(1, rowCount - rows.length))),
    );
    const row: string[] = [];
    let width = 0;
    while (index < ids.length && (!row.length || width + widthOf(ids[index]!) <= target)) {
      width += widthOf(ids[index]!);
      row.push(ids[index]!);
      index += 1;
    }
    rows.push(row);
  }
  return rows;
}

export function groupRows(group: SiblingGroup, subtreeRows: (id: string) => number): number {
  if (group.kind === "branch") return subtreeRows(group.id);
  return group.rows.length + Math.max(0, group.rows.length - 1) * SHELF_ROW_GAP_ROWS;
}

/** How many columns a band of children reaches across: a branch reaches as far
 * as its own subtree, a shelf as far as its widest row. */
export function groupColumns(
  group: SiblingGroup,
  subtreeColumns: (id: string) => number,
  shelfWidth: ShelfWidth,
): number {
  if (group.kind === "branch") return subtreeColumns(group.id);
  return Math.max(
    0,
    ...group.rows.map((row) => row.reduce((sum, id) => sum + (shelfWidth(id) ?? 1), 0)),
  );
}

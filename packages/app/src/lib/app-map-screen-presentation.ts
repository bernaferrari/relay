export function screenCardActionsVisible(input: {
  selected: boolean;
  showActions?: boolean;
  editing: boolean;
  detailsOpen?: boolean;
}): boolean {
  return input.selected && input.showActions !== false && !input.editing;
}

export function screenCardStartMarkerVisible(title: string, isFlowStart: boolean): boolean {
  return isFlowStart && title.trim().toLocaleLowerCase() !== "start";
}

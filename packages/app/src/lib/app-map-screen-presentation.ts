export function screenCardActionsVisible(input: {
  selected: boolean;
  showActions?: boolean;
  editing: boolean;
  hasRunAction: boolean;
}): boolean {
  return input.selected && input.showActions !== false && !input.editing && input.hasRunAction;
}

export function screenCardStartMarkerVisible(title: string, isFlowStart: boolean): boolean {
  return isFlowStart && title.trim().toLocaleLowerCase() !== "start";
}

import type { Accessor } from "solid-js";
import type { RecipeStep, StepTarget } from "../context/server";
import type { Strategy } from "../lib/step-target";

export type StepEditorFamilyProps = {
  step: Accessor<RecipeStep>;
  autofocus: Accessor<boolean>;
  onAutofocused: () => void;
  onChange: (next: RecipeStep) => void;
  target: Accessor<StepTarget>;
  strategy: Accessor<Strategy>;
  onStrategy: (strategy: Strategy) => void;
  onPatchTarget: (patch: Partial<StepTarget>) => void;
  onRetargetTap: (strategy: Strategy) => void;
};

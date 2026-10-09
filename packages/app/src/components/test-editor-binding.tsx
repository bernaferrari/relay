/** @jsxImportSource react */
import type { AppMapScenarioTestStep, AppMapTestBindingCandidate } from "@relay/protocol";
import { Button } from "@relay/ui-react/components/button";
import { Input } from "@relay/ui-react/components/input";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import type { EditTransaction } from "./test-editor-step";

export function BindingRepair({
  step,
  candidates,
  busy,
  onBind,
  appMapId,
}: {
  step: AppMapScenarioTestStep;
  candidates: readonly AppMapTestBindingCandidate[];
  busy: boolean;
  onBind(transaction: EditTransaction): void;
  appMapId?: string;
}) {
  const [search, setSearch] = useState("");
  const unique = [
    ...new Map(
      candidates.map((candidate) => [`${candidate.kind}:${candidate.id}`, candidate]),
    ).values(),
  ];
  const bindable = unique.flatMap((candidate) => {
    const binding = bindingForCandidate(step, candidate);
    return binding ? [{ candidate, binding }] : [];
  });
  const matches = bindable.filter(({ candidate }) =>
    candidate.label.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()),
  );
  return (
    <details className="rounded-lg border border-border bg-background">
      <summary className="cursor-pointer px-3 py-3 text-sm font-medium">
        {step.binding.status === "resolved" ? "Change action" : "Connect action"}{" "}
        <span className="ml-2 text-xs font-normal text-muted-foreground">Choose a saved path</span>
      </summary>
      <div className="grid gap-3 border-t border-border p-3">
        <div>
          <p className="mt-0.5 text-xs leading-normal text-muted-foreground">
            Choose the action that matches this step and its starting screen. Run the test to verify
            it.
          </p>
        </div>
        <label className="grid gap-1.5 text-sm" htmlFor="saved-path-search">
          Find a saved path
          <Input
            id="saved-path-search"
            type="search"
            className="text-base"
            value={search}
            onChange={(event) => setSearch(event.currentTarget.value)}
            placeholder="Imagine, model, sign in…"
          />
        </label>
        {!matches.length ? (
          <p className="text-sm text-muted-foreground">
            {bindable.length ? "No paths match your search." : "No saved path is available yet."}
          </p>
        ) : null}
        <div className="grid max-h-64 gap-1.5 overflow-y-auto">
          {matches.map(({ candidate, binding }) => (
            <Button
              key={`${candidate.kind}:${candidate.id}`}
              type="button"
              size="sm"
              variant="outline"
              className="h-auto min-h-11 justify-start whitespace-normal text-left"
              disabled={busy}
              onClick={() =>
                onBind({
                  label: `Bound ${step.intent} to ${candidate.label}`,
                  forward: [{ kind: "step.bind", stepId: step.id, binding }],
                  reverse: [
                    step.binding.status === "resolved"
                      ? {
                          kind: "step.bind",
                          stepId: step.id,
                          binding: structuredClone(step.binding),
                        }
                      : {
                          kind: "step.unbind",
                          stepId: step.id,
                          reason:
                            step.binding.status === "unresolved"
                              ? step.binding.reason
                              : "Needs setup",
                          ...(step.binding.status === "unresolved" && step.binding.candidates
                            ? { candidates: structuredClone(step.binding.candidates) }
                            : {}),
                        },
                  ],
                })
              }
            >
              Use {candidate.label}
            </Button>
          ))}
        </div>
        {appMapId && step.kind === "instruction" ? (
          <div className="grid gap-2 border-t border-border pt-3">
            <p className="text-xs text-muted-foreground">
              Missing an action? Record it in this app, save the recording, then return here to
              connect its path.
            </p>
            <Button
              type="button"
              nativeButton={false}
              variant="outline"
              disabled={busy}
              render={<Link to="/tests/new" search={{ app: appMapId }} />}
            >
              Record a missing path
            </Button>
          </div>
        ) : null}
      </div>
    </details>
  );
}

function bindingForCandidate(
  step: AppMapScenarioTestStep,
  candidate: AppMapTestBindingCandidate,
): AppMapScenarioTestStep["binding"] | undefined {
  if (step.kind === "instruction" && candidate.kind === "connection") {
    return { status: "resolved", kind: "connections", connectionIds: [candidate.id] };
  }
  if (step.kind === "module" && candidate.kind === "routine") {
    return { status: "resolved", kind: "routine", routineId: candidate.id };
  }
  return undefined;
}

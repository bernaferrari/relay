/** @jsxImportSource react */
import { Button } from "@relay/ui-react/components/button";
import { Check, CircleDot, History, Sparkles } from "lucide-react";
import type {
  ProductTestEditorDocument,
  ProductTestRepair,
} from "../data/test-editor-product-service";
import { relativeTime } from "#lib/relative-time";

export function RepairSection({
  repairs,
  busy,
  onDecision,
}: {
  repairs: readonly ProductTestRepair[];
  busy: boolean;
  onDecision(repair: ProductTestRepair, decision: "approve" | "reject" | "revert"): void;
}) {
  return (
    <section className="min-w-0" aria-labelledby="repairs-title">
      <div className="flex items-center gap-2.5">
        <Sparkles aria-hidden="true" />
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Review
          </p>
          <h2 id="repairs-title">Suggested repairs</h2>
        </div>
      </div>
      {repairs.length ? (
        <ul className="grid list-none gap-2 p-0">
          {repairs.map((proposal) => (
            <li
              className="flex min-w-0 items-start justify-between gap-3 border-t border-border pt-2"
              key={proposal.id}
            >
              <div>
                <strong>{proposal.title}</strong>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {proposal.description ??
                    `${proposal.editCount} suggested ${proposal.editCount === 1 ? "change" : "changes"}`}
                </p>
              </div>
              <div>
                {proposal.status === "pending" ? (
                  <>
                    <Button
                      size="sm"
                      variant="default"
                      disabled={busy}
                      onClick={() => onDecision(proposal, "approve")}
                    >
                      Apply repair
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy}
                      onClick={() => onDecision(proposal, "reject")}
                    >
                      Dismiss
                    </Button>
                  </>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() => onDecision(proposal, "revert")}
                  >
                    Revert repair
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <Check aria-hidden="true" /> No repairs are waiting for review.
        </p>
      )}
    </section>
  );
}

export function HistorySection({ items }: { items: ProductTestEditorDocument["history"] }) {
  return (
    <section className="min-w-0" aria-labelledby="history-title">
      <div className="flex items-center gap-2.5">
        <History aria-hidden="true" />
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Saved activity
          </p>
          <h2 id="history-title">History</h2>
        </div>
      </div>
      {items.length ? (
        <ol className="grid list-none gap-2 p-0">
          {items.slice(0, 8).map((item) => (
            <li
              className="flex min-w-0 items-start gap-2 border-t border-border pt-2"
              key={item.id}
            >
              <CircleDot aria-hidden="true" />
              <div>
                <strong className="block text-xs font-semibold">{item.summary}</strong>
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  {item.actorKind === "human" ? "You" : "Agent"} · {relativeTime(item.at)}
                </span>
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <p className="text-xs text-muted-foreground">Saved edits will appear here.</p>
      )}
    </section>
  );
}

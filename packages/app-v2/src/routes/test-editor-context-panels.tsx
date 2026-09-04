/** @jsxImportSource react */
import { Button } from "@relay/ui-react";
import { Check, CircleDot, History, Sparkles } from "lucide-react";
import type {
  ProductTestEditorDocument,
  ProductTestRepair,
} from "../data/test-editor-product-service";

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
    <section className="relay-editor-context-panel" aria-labelledby="repairs-title">
      <div className="relay-context-heading">
        <Sparkles aria-hidden="true" />
        <div>
          <p className="relay-section-label">Review</p>
          <h2 id="repairs-title">Suggested repairs</h2>
        </div>
      </div>
      {repairs.length ? (
        <ul className="relay-editor-context-list">
          {repairs.map((proposal) => (
            <li key={proposal.id}>
              <div>
                <strong>{proposal.title}</strong>
                <p>
                  {proposal.description ??
                    `${proposal.editCount} suggested ${proposal.editCount === 1 ? "change" : "changes"}`}
                </p>
              </div>
              <div>
                {proposal.status === "pending" ? (
                  <>
                    <Button
                      size="small"
                      variant="primary"
                      disabled={busy}
                      onClick={() => onDecision(proposal, "approve")}
                    >
                      Apply repair
                    </Button>
                    <Button
                      size="small"
                      variant="ghost"
                      disabled={busy}
                      onClick={() => onDecision(proposal, "reject")}
                    >
                      Dismiss
                    </Button>
                  </>
                ) : (
                  <Button
                    size="small"
                    variant="secondary"
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
        <p className="relay-context-empty">
          <Check aria-hidden="true" /> No repairs are waiting for review.
        </p>
      )}
    </section>
  );
}

export function HistorySection({ items }: { items: ProductTestEditorDocument["history"] }) {
  return (
    <section className="relay-editor-context-panel" aria-labelledby="history-title">
      <div className="relay-context-heading">
        <History aria-hidden="true" />
        <div>
          <p className="relay-section-label">Saved activity</p>
          <h2 id="history-title">History</h2>
        </div>
      </div>
      {items.length ? (
        <ol className="relay-editor-history-list">
          {items.slice(0, 8).map((item) => (
            <li key={item.id}>
              <CircleDot aria-hidden="true" />
              <div>
                <strong>{item.summary}</strong>
                <span>
                  {item.actorKind === "human" ? "You" : "Agent"} · {relativeTime(item.at)}
                </span>
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <p className="relay-context-empty">Saved edits will appear here.</p>
      )}
    </section>
  );
}

function relativeTime(value: number): string {
  const elapsed = Math.max(0, Date.now() - value);
  if (elapsed < 60_000) return "Just now";
  if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)}m ago`;
  if (elapsed < 86_400_000) return `${Math.floor(elapsed / 3_600_000)}h ago`;
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(value);
}

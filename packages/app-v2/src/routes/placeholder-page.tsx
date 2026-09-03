/** @jsxImportSource react */
import type { RouteContract } from "../router/route-contract";

export function PlaceholderPage({ contract }: { contract: RouteContract }) {
  return (
    <section className="relay-page" data-route-pattern={contract.pattern}>
      <header className="relay-page-header">
        <p className="relay-eyebrow">{contract.eyebrow}</p>
        <h1>{contract.title}</h1>
        <p className="relay-page-description">{contract.description}</p>
      </header>
      <div className="relay-foundation-state">
        <span className="relay-foundation-mark" aria-hidden="true" />
        <div>
          <h2>Nothing to show yet</h2>
          <p>This area will become available when it has real Relay data to show.</p>
        </div>
      </div>
    </section>
  );
}

import type { JSX } from "solid-js";

/**
 * The compact Relay mark used where the full macOS app icon would be too
 * detailed to recognise. It keeps the app's connected-path motif legible at
 * toolbar scale without introducing a second logo treatment.
 */
export function RelayMark(props: { size?: number; class?: string }): JSX.Element {
  const size = () => props.size ?? 18;
  return (
    <svg
      class={props.class}
      width={size()}
      height={size()}
      viewBox="0 0 20 20"
      fill="none"
      aria-hidden="true"
    >
      <rect width="20" height="20" rx="6" fill="var(--v2-background-bg-accent)" />
      <path
        d="M5 11.7c1.2 2.2 4.2 2.9 6.8 1.5 2.2-1.1 3.4-3.4 3.1-5.5"
        stroke="white"
        stroke-linecap="round"
        stroke-width="1.55"
      />
      <circle cx="5" cy="11.7" r="1.55" fill="white" />
      <circle cx="14.9" cy="7.7" r="1.55" fill="white" />
    </svg>
  );
}

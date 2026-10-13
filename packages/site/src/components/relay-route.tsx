/** The connected path from Relay’s mark; decorative, never a status indicator. */
export function RelayRoute() {
  return (
    <svg
      viewBox="0 0 64 20"
      fill="none"
      className="h-5 w-16 shrink-0 text-primary"
      aria-hidden="true"
    >
      <path
        d="M4 14h18c6 0 6-8 12-8h26"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <g className="text-route-gold" fill="currentColor">
        <circle cx="4" cy="14" r="3" />
        <circle cx="32" cy="7" r="3" />
        <circle cx="60" cy="6" r="3" />
      </g>
    </svg>
  );
}

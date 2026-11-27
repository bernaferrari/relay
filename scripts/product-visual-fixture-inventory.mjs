/**
 * Single source of truth for the product visual-fixture inventory.
 *
 * The regression runner captures every fixture at every viewport, so the
 * checked-in baselines under packages/app/visual-fixtures must match this
 * matrix exactly — no orphans, no gaps. scripts/product-visual-inventory.test.mjs
 * enforces that the files on disk stay in lockstep with this list.
 */
export const visualFixtures = [
  { id: "home-empty", heading: "Tests" },
  { id: "home-populated", heading: "Tests" },
  { id: "apps-list", heading: "Apps" },
  { id: "apps-error", heading: "Apps" },
  { id: "prerecord-ready", heading: "New test" },
  { id: "prerecord-connecting", heading: "New test" },
  { id: "prerecord-failure", heading: "New test" },
  {
    id: "recording-review",
    heading: "Review test",
    recordingReview: true,
  },
  { id: "recording-active", heading: "Record test" },
  { id: "test-detail", heading: "Complete checkout and confirm the order" },
  { id: "runs-large", heading: "Runs" },
  { id: "report-replay", heading: "Complete checkout" },
  { id: "report-failed", heading: "Complete checkout" },
  { id: "report-video", heading: "Complete checkout", video: true },
  { id: "report-evidence", heading: "Complete checkout", evidenceMedia: true },
  { id: "batch-completed", heading: "Checkout across saved accounts", batch: true },
  { id: "suite-detail", heading: "Release smoke" },
  { id: "environments-list", heading: "Devices" },
  { id: "environment-detail", heading: "Checkout staging" },
  { id: "devices", heading: "Devices" },
  { id: "tests-library", heading: "Tests" },
  { id: "map-overview", heading: "Checkout map" },
  { id: "device-detail", heading: "Pixel 9 Pro XL" },
  { id: "settings-general", heading: "General" },
  { id: "settings-evidence", heading: "Privacy" },
  { id: "settings-integrations", heading: "Integrations" },
  { id: "settings-appearance", heading: "Appearance" },
  { id: "settings-advanced", heading: "Advanced" },
  { id: "settings-about", heading: "Help & about" },
  { id: "not-found", heading: "This page is not available" },
  { id: "route-error", heading: "This page couldn’t load" },
];

export const visualViewports = [
  { id: "compact", width: 800, height: 560 },
  { id: "desktop", width: 1243, height: 838 },
  { id: "dark", width: 1243, height: 838, colorScheme: "dark" },
];

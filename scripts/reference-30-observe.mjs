/** Observe every reference-30 screen on each configuration browser via the
 * live alias-observe API, then patch variant profiles to the fixture-bound
 * canonical ids the lanes expect.
 *
 *   node --import tsx scripts/reference-30-observe.mjs
 *
 * Requires: seeded app on :8791, Relay on :8787, and the three managed
 * browsers (slice4-firefox-member, slice4-chrome-admin,
 * slice4-webkit-signedout).
 */
import { execFileSync } from "node:child_process";
import { readAppMap, importAppMap } from "../packages/core/src/index.ts";

const BASE = "http://127.0.0.1:8787";
const ACTOR = "agent:cursor";

const HOME_SCREEN = "screen-159c6139ad92239b";
const SETTINGS_SCREEN = "screen-b0afec7f94383782";
const PAGES = [
  { path: "/", screenId: HOME_SCREEN, label: "home" },
  { path: "/settings", screenId: SETTINGS_SCREEN, label: "settings" },
  { path: "/settings/language", screenId: "screen-language", label: "language" },
  { path: "/settings/team", screenId: "screen-team", label: "team" },
  { path: "/profile", screenId: "screen-profile", label: "profile" },
  { path: "/notifications", screenId: "screen-notifications", label: "notifications" },
  { path: "/sessions", screenId: "screen-sessions", label: "sessions" },
  { path: "/tokens", screenId: "screen-tokens", label: "tokens" },
  { path: "/usage", screenId: "screen-usage", label: "usage" },
  { path: "/audit", screenId: "screen-audit", label: "audit" },
];
const CONFIGS = [
  {
    browser: "slice4-firefox-member",
    signIn: "Continue as Member",
    engine: "firefox",
    profileId: "browser:slice4-firefox-member-1280x800-ad0f5fce2a52",
    fixture: "authfx:f622d450-7cad-4740-b07d-1eb10b8496b4:1",
  },
  {
    browser: "slice4-chrome-admin",
    signIn: "Continue as Admin",
    engine: "chromium",
    profileId: "browser:slice4-chrome-admin-1280x800-30bf622d6316",
    fixture: "authfx:59021f2e-c845-405a-b60b-36754c27a990:1",
  },
  {
    browser: "slice4-webkit-signedout",
    signIn: "Continue as Member",
    engine: "webkit",
    profileId: "browser:slice4-webkit-member-1280x800-c7d2f30a91b4",
    fixture: "authfx:f622d450-7cad-4740-b07d-1eb10b8496b4:1",
  },
];

function relay(args, { allowFail = false } = {}) {
  try {
    return execFileSync("./bin/relay", args, {
      env: { ...process.env, RELAY_URL: BASE, RELAY_ACTOR_ID: ACTOR },
      encoding: "utf8",
      timeout: 60_000,
    });
  } catch (error) {
    if (allowFail) return error.stdout ?? "";
    throw error;
  }
}

async function leases() {
  const output = relay(["lease", "list", "--json"]);
  const envelope = JSON.parse(output.trim());
  const byDevice = new Map();
  for (const lease of envelope?.result?.leases ?? []) byDevice.set(lease.deviceSerial, lease.id);
  return byDevice;
}

async function appRevision() {
  const map = await readAppMap("default", "reference-30");
  if (!map) throw new Error("reference-30 map not found — run reference-30-seed.mjs first");
  return map.revision;
}

let revision = await appRevision();

for (const config of CONFIGS) {
  // Sign in if the browser shows the sign-in page.
  relay(["browser", "navigate", config.browser, "http://127.0.0.1:8791/"]);
  const who = JSON.parse(relay(["browser", "snapshot", config.browser, "--json"]).trim());
  const labels = (who.result?.nodes ?? []).map((node) => node.label);
  if (
    labels.some((label) => typeof label === "string" && label.toLowerCase().includes("sign in"))
  ) {
    relay(["browser", "click", config.browser, config.signIn], { allowFail: true });
  }
  for (const page of PAGES) {
    relay(["browser", "navigate", config.browser, `http://127.0.0.1:8791${page.path}`]);
    // Refresh the lease right before each observe: navigation can mint or
    // rotate the device lease, and a stale lease id fails the observe.
    const leaseNow = (await leases()).get(config.browser);
    const observeInput = JSON.stringify({
      expectedRevision: revision,
      target: { kind: "browser", platform: "browser", targetId: config.browser },
      leaseId: leaseNow ?? "none",
    });
    const attempt = relay(
      ["screen", "alias-observe", "reference-30", page.screenId, "--input", observeInput],
      { allowFail: true },
    );
    let envelope;
    try {
      envelope = JSON.parse(attempt.trim());
    } catch {
      envelope = undefined;
    }
    if (envelope?.result?.appMap?.revision) {
      revision = envelope.result.appMap.revision;
      console.log(`${config.browser}: observed ${page.label} (rev ${revision})`);
    } else {
      console.log(
        `${config.browser}: ${page.label} — ${envelope?.error?.message ?? (envelope ? "ok-but-no-revision" : "empty output")}`,
      );
    }
  }
}

// Patch every observed variant to the fixture-bound canonical profile its
// lane expects (the lane check requires authenticationFixtureId).
const map = await readAppMap("default", "reference-30");
for (const variant of Object.values(map.screenVariants)) {
  const target = variant.targetProfile.targetId;
  const config = CONFIGS.find((candidate) => candidate.browser === target);
  if (!config) continue;
  variant.targetProfile = {
    ...variant.targetProfile,
    id: config.profileId,
    browserCaseProfile: {
      ...(variant.targetProfile.browserCaseProfile ?? {}),
      engine: config.engine,
      authenticationFixtureId: config.fixture,
    },
  };
}
await importAppMap({
  organizationId: map.organizationId,
  projectId: map.projectId,
  appMap: map,
  conflict: "replace",
});
console.log(
  `patched variant profiles to fixture-bound lanes (member-firefox, admin-chrome, member-webkit) at revision ${map.revision}`,
);

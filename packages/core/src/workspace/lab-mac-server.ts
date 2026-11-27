/**
 * Lab Mac launchd is how an unattended host keeps :8787 up. This inspection is
 * read-only. Loading `dev.relay.lab-server` while a Plan is live restarts the
 * watched server — never do that from Settings or from an agent session.
 */

export const LAB_MAC_LAUNCHD_LABEL = "dev.relay.lab-server";

export type LabMacServerStatus = {
  status: "ready" | "needs-attention";
  detail: string;
  loaded: boolean;
};

export const LAB_MAC_SERVER_NOT_LOADED =
  "Lab Mac launchd stays unloaded. Job dev.relay.lab-server is not loaded. Morning review stays on this Vite UI plus pnpm ensure:serve. Do not load that job while a Plan is live — it would restart :8787.";

const LAB_MAC_SERVER_RUNNING = `${LAB_MAC_LAUNCHD_LABEL} is running. Morning review can use this host unattended.`;

/** Parse `launchctl print gui/<uid>/dev.relay.lab-server`. Never treats a missing job as ready. */
export function inspectLabMacLaunchd(printOutput: string | null): LabMacServerStatus {
  const output = printOutput ?? "";
  if (/Could not find service/i.test(output)) {
    return { status: "needs-attention", detail: LAB_MAC_SERVER_NOT_LOADED, loaded: false };
  }
  const namesThisJob = output.includes(LAB_MAC_LAUNCHD_LABEL);
  const running = /\bstate\s*=\s*running\b/i.test(output);
  if (namesThisJob && running) {
    return { status: "ready", detail: LAB_MAC_SERVER_RUNNING, loaded: true };
  }
  return { status: "needs-attention", detail: LAB_MAC_SERVER_NOT_LOADED, loaded: false };
}

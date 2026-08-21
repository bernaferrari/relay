import type { Accessor, Setter } from "solid-js";
import type { CombineCampaign } from "@relay/protocol";
import { toast } from "../context/toast";
import { humanError } from "./human-error";

/** Durable campaign controls stay together so the Combine editor only owns
 * authoring state; each action keeps feedback and busy state consistent. */
export function createAppMapCombineCampaignActions(input: {
  campaignId: Accessor<string | undefined>;
  pilotJobId: Accessor<string | undefined>;
  reviewed: Accessor<boolean>;
  busy: Accessor<boolean>;
  setBusy: Setter<boolean>;
  setCampaign: Setter<CombineCampaign | undefined>;
  combineCampaign: {
    resume: (id: string, reviewed: boolean) => Promise<CombineCampaign>;
    cancel: (id: string) => Promise<CombineCampaign>;
  };
}) {
  function openPilot(): void {
    window.dispatchEvent(
      new CustomEvent("relay:open-run-history", { detail: { jobId: input.pilotJobId() } }),
    );
  }

  function resume(): void {
    const id = input.campaignId();
    if (!id || input.busy()) return;
    input.setBusy(true);
    void input.combineCampaign
      .resume(id, input.reviewed())
      .then((campaign) => {
        input.setCampaign(campaign);
        toast("Running untouched campaign cases", "success");
        window.dispatchEvent(new CustomEvent("relay:open-device-panel"));
      })
      .catch((error) => toast(humanError(error, "Could not resume campaign"), "error"))
      .finally(() => input.setBusy(false));
  }

  function cancel(): void {
    const id = input.campaignId();
    if (!id || input.busy()) return;
    input.setBusy(true);
    void input.combineCampaign
      .cancel(id)
      .then(input.setCampaign)
      .catch((error) => toast(humanError(error, "Could not stop campaign"), "error"))
      .finally(() => input.setBusy(false));
  }

  return { openPilot, resume, cancel };
}

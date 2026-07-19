import type { RedactionPolicy } from "@relay/protocol";
import type { ServerRequest } from "./server-matrix-remote";

export async function loadRedactionPolicy(request: ServerRequest): Promise<RedactionPolicy> {
  const data = await request<{ policy: RedactionPolicy }>("/settings/privacy");
  return data.policy;
}

export async function setRedactionEnabled(
  request: ServerRequest,
  enabled: boolean,
): Promise<RedactionPolicy> {
  const data = await request<{ policy: RedactionPolicy }>("/settings/privacy", {
    method: "PUT",
    body: JSON.stringify({ enabled }),
  });
  return data.policy;
}

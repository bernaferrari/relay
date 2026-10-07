import { register } from "node:module";

// Only the external device transport is replaced. The child retains Relay's
// public routes, queue, canonical dispatcher, evidence validation and stores.
const sdk = new URL("./combine-frozen-input-sdk.ts", import.meta.url).href;
register(
  `data:text/javascript,${encodeURIComponent(`
  export async function resolve(specifier, context, nextResolve) {
    if (specifier === "agent-device") return { url: ${JSON.stringify(sdk)}, shortCircuit: true };
    return nextResolve(specifier, context);
  }
`)}`,
  import.meta.url,
);

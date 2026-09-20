import { B as centerOfRect, G as isAgentDeviceError, K as normalizeAgentDeviceError, V as AppError } from "./sdk-contracts.js";
import { n as AgentDeviceClientConfig, r as AgentDeviceDaemonTransport, t as AgentDeviceClient } from "./client-types.js";
import { p as createLocalArtifactAdapter } from "./sdk-io.js";
//#region src/agent-device-client.d.ts
declare function createAgentDeviceClient(config?: AgentDeviceClientConfig, deps?: {
  transport?: AgentDeviceDaemonTransport;
}): AgentDeviceClient;
//#endregion
export { AppError, centerOfRect, createAgentDeviceClient, createLocalArtifactAdapter, isAgentDeviceError, normalizeAgentDeviceError };
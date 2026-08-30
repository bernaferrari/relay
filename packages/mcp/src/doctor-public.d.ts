import type { RelayMcpProfile } from "./tools.js";

export type RelayMcpDoctorCheck = {
  readonly name: string;
  readonly ok: boolean;
  readonly message: string;
};

export type RelayMcpDoctorReport = {
  readonly ok: boolean;
  readonly config: {
    readonly server: string;
    readonly organization: string;
    readonly project: string;
    readonly actor: string;
    readonly actorKind: "agent";
    readonly profile: RelayMcpProfile;
  };
  readonly proofTools: readonly string[];
  readonly checks: readonly RelayMcpDoctorCheck[];
};

export declare function runRelayMcpDoctor(
  argv?: readonly string[],
  env?: Record<string, string | undefined>,
  fetchImpl?: typeof fetch,
): Promise<RelayMcpDoctorReport>;
export declare function formatRelayMcpDoctor(report: RelayMcpDoctorReport): string;
export declare function runRelayMcpDoctorCommand(
  argv?: readonly string[],
  env?: Record<string, string | undefined>,
  fetchImpl?: typeof fetch,
): Promise<number>;
export { relayMcpProfiles } from "./tools.js";

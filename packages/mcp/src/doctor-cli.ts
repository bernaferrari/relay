#!/usr/bin/env tsx
import { runRelayMcpDoctorCommand } from "./doctor.js";

try {
  const exitCode = await runRelayMcpDoctorCommand(process.argv.slice(2));
  process.exitCode = exitCode;
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`relay-proof-doctor: ${message}\n`);
  process.exitCode = 1;
}

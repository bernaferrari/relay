import type { TargetProfile } from "@relay/protocol";
import type {
  ActionSpec,
  AddScreenInput,
  AppMap,
  BaselineProvenance,
  Connection,
  Proposal,
  ProposalChange,
  Routine,
  Screen,
  ScreenVariant,
  SerializedAppMap,
} from "./model.js";
import { APP_MAP_SCHEMA_VERSION } from "./model.js";
import { validateAppMap } from "./validation.js";

function canonicalPlain(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalPlain);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, canonicalPlain(item)]),
  );
}

function sortedStrings(values: readonly string[]): string[] {
  return [...values].sort((left, right) => left.localeCompare(right));
}

function normalizedProfile(value: TargetProfile): TargetProfile {
  return { ...structuredClone(value), capabilities: [...value.capabilities].sort() };
}

function normalizedBaseline(value?: BaselineProvenance): BaselineProvenance | undefined {
  if (!value) return undefined;
  if (value.source.kind === "recording" || value.source.kind === "manual") {
    return {
      ...structuredClone(value),
      source: { ...value.source, evidenceIds: sortedStrings(value.source.evidenceIds) },
    };
  }
  return structuredClone(value);
}

function normalizedAction(value: ActionSpec): ActionSpec {
  if (value.kind === "recorded") {
    return { ...structuredClone(value), evidenceIds: sortedStrings(value.evidenceIds) };
  }
  if (value.kind === "routine" && value.bindings) {
    return {
      ...structuredClone(value),
      bindings: Object.fromEntries(
        Object.entries(value.bindings).sort(([left], [right]) => left.localeCompare(right)),
      ),
    };
  }
  return structuredClone(value);
}

function normalizedScreen(value: Screen): Screen {
  const identity = value.identity
    ? {
        ...structuredClone(value.identity),
        ...(value.identity.aliases ? { aliases: sortedStrings(value.identity.aliases) } : {}),
      }
    : undefined;
  return {
    ...structuredClone(value),
    variantIds: sortedStrings(value.variantIds),
    ...(identity ? { identity } : {}),
  };
}

function normalizedVariant(value: ScreenVariant): ScreenVariant {
  const baseline = normalizedBaseline(value.baseline);
  return {
    ...structuredClone(value),
    targetProfile: normalizedProfile(value.targetProfile),
    evidenceIds: sortedStrings(value.evidenceIds),
    ...(baseline ? { baseline } : {}),
  };
}

function normalizedConnection(value: Connection): Connection {
  return { ...structuredClone(value), actions: value.actions.map(normalizedAction) };
}

function normalizedRoutine(value: Routine): Routine {
  return { ...structuredClone(value), actions: value.actions.map(normalizedAction) };
}

function normalizedAddScreenInput(value: AddScreenInput): AddScreenInput {
  return {
    screen: normalizedScreen(value.screen),
    ...(value.variants
      ? {
          variants: [...value.variants]
            .sort((left, right) => left.id.localeCompare(right.id))
            .map(normalizedVariant),
        }
      : {}),
  };
}

function normalizedProposalChange(value: ProposalChange): ProposalChange {
  switch (value.kind) {
    case "screen.add":
      return { kind: value.kind, input: normalizedAddScreenInput(value.input) };
    case "screen.update":
      return {
        kind: value.kind,
        screenId: value.screenId,
        input: {
          patch: structuredClone(value.input.patch),
          ...(value.input.upsertVariants
            ? {
                upsertVariants: [...value.input.upsertVariants]
                  .sort((left, right) => left.id.localeCompare(right.id))
                  .map(normalizedVariant),
              }
            : {}),
          ...(value.input.removeVariantIds
            ? { removeVariantIds: sortedStrings(value.input.removeVariantIds) }
            : {}),
        },
      };
    case "connection.connect":
      return { kind: value.kind, connection: normalizedConnection(value.connection) };
    case "connection.update":
      return {
        kind: value.kind,
        connectionId: value.connectionId,
        patch: {
          ...structuredClone(value.patch),
          ...(value.patch.actions ? { actions: value.patch.actions.map(normalizedAction) } : {}),
        },
      };
    default:
      return structuredClone(value);
  }
}

function normalizedProposal(value: Proposal): Proposal {
  return { ...structuredClone(value), changes: value.changes.map(normalizedProposalChange) };
}

function sortedEntities<T extends { id: string }>(values: Record<string, T>): T[] {
  return Object.values(values)
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((value) => structuredClone(value));
}

/** A deterministic, de-normalized plain object ready for a YAML stringifier. */
export function serializeAppMap(value: AppMap): SerializedAppMap {
  const map = validateAppMap(value);
  const document: SerializedAppMap = {
    schemaVersion: APP_MAP_SCHEMA_VERSION,
    id: map.id,
    organizationId: map.organizationId,
    projectId: map.projectId,
    name: map.name,
    revision: map.revision,
    screens: sortedEntities(map.screens).map(normalizedScreen),
    screenVariants: sortedEntities(map.screenVariants).map(normalizedVariant),
    connections: sortedEntities(map.connections).map(normalizedConnection),
    routines: sortedEntities(map.routines).map(normalizedRoutine),
    flows: sortedEntities(map.flows),
    runs: sortedEntities(map.runs).map((run) => ({
      ...run,
      targetResultIds: sortedStrings(run.targetResultIds),
    })),
    targetResults: sortedEntities(map.targetResults).map((result) => ({
      ...result,
      targetProfile: normalizedProfile(result.targetProfile),
      evidenceIds: sortedStrings(result.evidenceIds),
    })),
    proposals: sortedEntities(map.proposals).map(normalizedProposal),
    activity: sortedEntities(map.activity).sort(
      (left, right) => left.at - right.at || left.id.localeCompare(right.id),
    ),
    createdAt: map.createdAt,
    updatedAt: map.updatedAt,
  };
  return canonicalPlain(document) as SerializedAppMap;
}

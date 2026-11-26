import type {
  EvidenceChannel,
  EvidenceManifest,
  EvidenceMetric,
  RegressionSignal,
} from "@relay/protocol";

type MetricContext = { targetProfileId?: string; appVersion?: string };

function sufficiency(
  manifest: EvidenceManifest,
  required: EvidenceChannel[],
): { ok: true; confidence: "high" | "medium" } | { ok: false; reason: string } {
  for (const name of required) {
    const channel = manifest.channels[name];
    if (!channel) return { ok: false, reason: `${name} channel is missing` };
    if (["unsupported", "denied", "failed"].includes(channel.status)) {
      return { ok: false, reason: `${name} channel is ${channel.status}` };
    }
    if (channel.dropped > 0) return { ok: false, reason: `${name} channel is truncated` };
  }
  return {
    ok: true,
    confidence: required.some((name) => manifest.channels[name].status !== "captured")
      ? "medium"
      : "high",
  };
}

function metric(
  manifest: EvidenceManifest,
  context: MetricContext,
  input: Omit<EvidenceMetric, "schemaVersion" | "status" | "confidence"> & {
    value: number;
  },
): EvidenceMetric {
  const sufficient = sufficiency(manifest, input.requiredChannels);
  if (!sufficient.ok) {
    return {
      schemaVersion: 1,
      id: input.id,
      unit: input.unit,
      status: "insufficient-evidence",
      reason: sufficient.reason,
      requiredChannels: input.requiredChannels,
      sourceSequences: input.sourceSequences,
      confidence: "low",
      ...context,
    };
  }
  return {
    schemaVersion: 1,
    ...input,
    status: "available",
    confidence: sufficient.confidence,
    ...context,
  };
}

export function extractEvidenceMetrics(
  manifest: EvidenceManifest,
  context: MetricContext = {},
): EvidenceMetric[] {
  const inputs = manifest.events.filter((event) => event.channel === "input");
  const attempts = inputs.filter((event) => ["tap", "type", "swipe"].includes(event.kind));
  const rapidClusters: number[] = [];
  for (let index = 2; index < attempts.length; index += 1) {
    const cluster = attempts.slice(index - 2, index + 1);
    if (
      cluster[2]!.monotonicMs - cluster[0]!.monotonicMs <= 1_000 &&
      new Set(cluster.map((event) => `${event.kind}:${event.stepId ?? ""}`)).size === 1
    ) {
      rapidClusters.push(cluster[2]!.sequence);
    }
  }
  const networkEvents = manifest.events.filter((event) => event.channel === "network");
  const logEvents = manifest.events.filter((event) => event.channel === "logs");
  const duration = Math.max(0, (manifest.finishedAt ?? manifest.startedAt) - manifest.startedAt);
  const networkEntries = manifest.channels.network.entries;
  const networkFailures = networkEvents.filter((event) => {
    const status = (event.data as { status?: unknown } | undefined)?.status;
    return typeof status === "number" && status >= 400;
  });
  const logErrors = logEvents.filter((event) => /error|exception|crash/i.test(event.kind));

  return [
    metric(manifest, context, {
      id: "completion.duration",
      unit: "ms",
      value: duration,
      requiredChannels: ["input"],
      sourceSequences: inputs.map((event) => event.sequence),
    }),
    metric(manifest, context, {
      id: "interaction.attempts",
      unit: "count",
      value: attempts.length,
      requiredChannels: ["input"],
      sourceSequences: attempts.map((event) => event.sequence),
    }),
    metric(manifest, context, {
      id: "interaction.rapid-repeat-clusters",
      unit: "count",
      value: rapidClusters.length,
      requiredChannels: ["input"],
      sourceSequences: rapidClusters,
    }),
    metric(manifest, context, {
      id: "network.requests",
      unit: "count",
      value: networkEntries,
      requiredChannels: ["network"],
      sourceSequences: networkEvents.map((event) => event.sequence),
    }),
    metric(manifest, context, {
      id: "network.failures",
      unit: "count",
      value: networkFailures.length,
      requiredChannels: ["network"],
      sourceSequences: networkFailures.map((event) => event.sequence),
    }),
    metric(manifest, context, {
      id: "log.errors",
      unit: "count",
      value: logErrors.length,
      requiredChannels: ["logs"],
      sourceSequences: logErrors.map((event) => event.sequence),
    }),
  ];
}

export function compareEvidenceMetrics(
  current: EvidenceMetric[],
  history: EvidenceMetric[][],
  budgets: Partial<Record<EvidenceMetric["id"], number>> = {},
): RegressionSignal[] {
  return current.map((metric) => {
    if (metric.status !== "available" || metric.value === undefined) {
      return { metric, material: false, direction: "unknown", reason: metric.reason };
    }
    const compatible = history
      .flatMap((set) => set)
      .filter(
        (candidate) =>
          candidate.id === metric.id &&
          candidate.status === "available" &&
          candidate.value !== undefined &&
          candidate.targetProfileId === metric.targetProfileId &&
          candidate.appVersion === metric.appVersion,
      );
    if (compatible.length === 0) {
      return { metric, material: false, direction: "unknown", reason: "no compatible baseline" };
    }
    const values = compatible.map((candidate) => candidate.value!).sort((a, b) => a - b);
    const median = values[Math.floor(values.length / 2)]!;
    const delta = metric.value - median;
    const budget = budgets[metric.id] ?? (metric.unit === "ms" ? Math.max(250, median * 0.2) : 1);
    const material = Math.abs(delta) > budget;
    return {
      metric,
      baseline: { median, sampleCount: values.length },
      delta,
      budget,
      material,
      direction: !material ? "neutral" : delta > 0 ? "regression" : "improvement",
    };
  });
}

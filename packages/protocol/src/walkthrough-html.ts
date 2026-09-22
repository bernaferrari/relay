import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import type { WalkthroughPackExportResponse } from "./walkthrough-pack.js";
import { captureReviewIdMatchesFrame } from "./capture-review.js";
import * as z from "zod/v4";

const listed = z.array(z.record(z.string(), z.unknown())).catch([]);

function escapeHtml(value: string | number): string {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function text(value: unknown): string {
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}

function imageSource(content: string): string | undefined {
  const compact = content.replaceAll(/\s/gu, "");
  if (!compact || !/^[A-Za-z0-9+/=]+$/u.test(compact)) return undefined;
  return `data:image/png;base64,${compact}`;
}

function contentDigest(content: string): string | undefined {
  const compact = content.replaceAll(/\s/gu, "");
  if (!compact || !/^[A-Za-z0-9+/=]+$/u.test(compact)) return undefined;
  try {
    const bytes = Uint8Array.from(atob(compact), (character) => character.charCodeAt(0));
    return bytesToHex(sha256(bytes));
  } catch {
    return undefined;
  }
}

/** The first frame whose bytes do not match the digest recorded for that run. */
export function walkthroughPackFrameProblem(
  result: WalkthroughPackExportResponse,
): string | undefined {
  for (const frame of result.pack.frames) {
    const actual = contentDigest(frame.content);
    if (!actual || actual !== frame.imageSha256) {
      return `Frame ${frame.framePath} on Run ${frame.runId} does not match the recorded digest.`;
    }
  }
  const frames = new Map(
    result.pack.frames.map((frame) => [`${frame.runId}\u0000${frame.framePath}`, frame]),
  );
  for (const capture of listed.parse(result.pack.manifest.captures)) {
    const framePath = text(capture.framePath);
    if (!framePath) continue;
    const runId = text(capture.runId) || "unknown";
    const expected = text(capture.imageSha256);
    if (!expected) return `Frame ${framePath} on Run ${runId} has no recorded digest.`;
    const frame = frames.get(`${text(capture.runId)}\u0000${framePath}`);
    if (!frame) return `Frame ${framePath} on Run ${runId} was not included.`;
    const actual = contentDigest(text(frame.content));
    if (actual !== expected || text(frame.imageSha256) !== expected) {
      return `Frame ${framePath} on Run ${runId} does not match the recorded digest.`;
    }
  }
  return undefined;
}
/** A teammate can open this file without Relay. One screen is visible.
 * Recorded and authored links move between screens already in the file.
 * The page never requests the tested application. */
export function walkthroughHtml(result: WalkthroughPackExportResponse): string {
  const manifest = result.pack.manifest;
  const pinned = manifest.pinned;
  const pinnedRuns = pinned.runIds.map((runId) => escapeHtml(runId)).join(", ");
  const identity = `<p>Pinned · ${escapeHtml(pinned.appMapId)} · revision ${escapeHtml(pinned.appMapRevision)} · ${pinnedRuns} · ${escapeHtml(new Date(pinned.generatedAt).toISOString())}</p>`;
  const frames = new Map(
    result.pack.frames.map((frame) => [`${frame.runId}\u0000${frame.framePath}`, frame]),
  );
  const variantLabel = new Map(
    listed.parse(manifest.variants).map((variant) => [text(variant.id), text(variant.label)]),
  );
  const stateTitle = new Map(
    listed.parse(manifest.states).map((state) => [text(state.id), text(state.title)]),
  );
  const captures = listed.parse(manifest.captures);
  const connections = listed.parse(manifest.connections);
  const findings = listed.parse(manifest.findings);
  const sections = captures
    .map((capture, index) => {
      const frame = frames.get(`${text(capture.runId)}\u0000${text(capture.framePath)}`);
      const expected = text(capture.imageSha256);
      const declared = text(frame?.imageSha256);
      const actual = frame ? contentDigest(text(frame.content)) : undefined;
      const digestMatches =
        (!expected || (declared === expected && actual === expected)) &&
        (!declared || actual === declared);
      const source = frame && digestMatches ? imageSource(frame.content) : undefined;
      const capturedAt = Number(capture.capturedAt);
      const captured = Number.isFinite(capturedAt)
        ? ` · ${escapeHtml(new Date(capturedAt).toISOString())}`
        : "";
      const variant = variantLabel.get(text(capture.variantId)) || text(capture.variantId);
      const title =
        stateTitle.get(text(capture.stateId)) || text(capture.caption) || "Recorded screen";
      const image = source
        ? `<img alt="${escapeHtml(title)}" src="${source}">`
        : frame
          ? "<p>This recorded frame was not embedded because its bytes do not match the recorded digest.</p>"
          : "<p>This recorded frame was not embedded.</p>";
      const review = findings
        .filter((finding) => {
          if (text(finding.runId) !== text(capture.runId)) return false;
          const captureId = text(finding.captureId);
          return (
            captureId === text(capture.id) ||
            captureId === `${text(capture.runId)}:${text(capture.framePath)}` ||
            captureReviewIdMatchesFrame(
              captureId,
              text(capture.framePath),
              text(capture.imageSha256),
            )
          );
        })
        .sort(
          (left, right) =>
            Number(right.decidedAt) - Number(left.decidedAt) ||
            Number(right.reviewVersion) - Number(left.reviewVersion),
        )
        .map((finding, index) => {
          const note = text(finding.note);
          const reviewer = text(finding.decidedBy);
          const version = Number(finding.reviewVersion);
          const revision = Number.isFinite(version) ? ` · v${escapeHtml(version)}` : "";
          const decidedAt = Number(finding.decidedAt);
          const decided = Number.isFinite(decidedAt)
            ? ` · ${escapeHtml(new Date(decidedAt).toISOString())}`
            : "";
          const status = index === 0 ? "Current review" : "Earlier review";
          return `<p>${status} · ${escapeHtml(text(finding.action))}${note ? ` · ${escapeHtml(note)}` : ""}${reviewer ? ` · ${escapeHtml(reviewer)}` : ""}${revision}${decided}</p>`;
        })
        .join("");
      const actions = connections
        .filter((connection) => {
          if (text(connection.fromStateId) !== text(capture.stateId)) return false;
          const provenance = z
            .record(z.string(), z.unknown())
            .catch({})
            .parse(connection.provenance);
          const runId =
            provenance && typeof provenance === "object" && !Array.isArray(provenance)
              ? text(provenance.runId)
              : "";
          if (text(connection.kind) === "recorded") return runId === text(capture.runId);
          return !runId || runId === text(capture.runId);
        })
        .map((connection) => {
          const destination = captures.findIndex(
            (candidate) =>
              text(candidate.stateId) === text(connection.toStateId) &&
              text(candidate.variantId) === text(capture.variantId),
          );
          const kind = text(connection.kind);
          const kindLabel =
            kind === "authored"
              ? "Authored"
              : kind === "recorded"
                ? "Recorded"
                : kind === "suggested"
                  ? "Suggested"
                  : kind || "Link";
          const label = `${kindLabel} · ${text(connection.label)}`;
          const hotspot = z.record(z.string(), z.unknown()).catch({}).parse(connection.hotspot);
          const geometry =
            hotspot && typeof hotspot === "object" && !Array.isArray(hotspot)
              ? hotspot.rect && typeof hotspot.rect === "object" && !Array.isArray(hotspot.rect)
                ? hotspot.rect
                : hotspot.point
              : undefined;
          const readAxis = (name: string) =>
            geometry && typeof geometry === "object" && !Array.isArray(geometry)
              ? Number((geometry as Record<string, unknown>)[name])
              : Number.NaN;
          const percent = (value: number) =>
            Number.isFinite(value) ? String(value <= 1 ? value * 100 : value) : "";
          const x = percent(readAxis("x"));
          const y = percent(readAxis("y"));
          const width = percent(readAxis("width"));
          const height = percent(readAxis("height"));
          const region = Boolean(width && height);
          const box = region ? `width:${width}%;height:${height}%;` : "";
          const provenance = z
            .record(z.string(), z.unknown())
            .catch({})
            .parse(connection.provenance);
          const recordedHere =
            kind === "recorded" &&
            Boolean(provenance) &&
            typeof provenance === "object" &&
            !Array.isArray(provenance) &&
            text(provenance.runId) === text(capture.runId);
          const marker =
            recordedHere && destination >= 0 && x && y
              ? `<a class="hotspot${region ? " region" : ""}" style="left:${escapeHtml(x)}%;top:${escapeHtml(y)}%;${box}" href="#capture-${destination}">${escapeHtml(label)}</a>`
              : "";
          return {
            marker,
            item:
              destination >= 0
                ? `<li><a href="#capture-${destination}">${escapeHtml(label)}</a></li>`
                : `<li>${escapeHtml(label)} · destination not captured in this configuration</li>`,
          };
        });
      const alternatives = captures
        .map((candidate, candidateIndex) => ({ candidate, candidateIndex }))
        .filter(
          ({ candidate, candidateIndex }) =>
            candidateIndex !== index && text(candidate.stateId) === text(capture.stateId),
        )
        .map(({ candidate, candidateIndex }) => {
          const label =
            variantLabel.get(text(candidate.variantId)) || text(candidate.variantId) || "Recorded";
          return `<li><a href="#capture-${candidateIndex}">${escapeHtml(label)}</a></li>`;
        })
        .join("");
      let previous = -1;
      for (let candidateIndex = 0; candidateIndex < index; candidateIndex++) {
        if (text(captures[candidateIndex]?.variantId) === text(capture.variantId))
          previous = candidateIndex;
      }
      const back = previous >= 0 ? `<p><a href="#capture-${previous}">Back</a></p>` : "";
      const markers = actions.map((action) => action.marker).join("");
      const items = actions.map((action) => action.item).join("");
      const digest = text(capture.imageSha256);
      const digestLine = digest ? `<p>Image ${escapeHtml(digest)}</p>` : "";
      return `<section id="capture-${index}"><h2>${escapeHtml(title)}</h2><p>Recorded · ${escapeHtml(variant)}${captured}</p>${digestLine}${back}<div class="stage">${image}${markers}</div>${review}<h3>Recorded actions</h3><ul>${items}</ul><h3>Other configurations</h3><ul>${alternatives}</ul></section>`;
    })
    .join("");
  const missing = listed
    .parse(manifest.missing)
    .map((entry) => {
      const variant = variantLabel.get(text(entry.variantId)) || text(entry.variantId);
      const state = stateTitle.get(text(entry.stateId)) || text(entry.stateId);
      const place = [variant, state].filter(Boolean).join(" · ");
      return `<li>Missing${place ? ` · ${escapeHtml(place)}` : ""} · ${escapeHtml(text(entry.reason))}</li>`;
    })
    .join("");
  const variantIds = [
    ...new Set(
      [
        ...captures.map((capture) => text(capture.variantId)),
        ...listed.parse(manifest.missing).map((entry) => text(entry.variantId)),
      ].filter(Boolean),
    ),
  ];
  const entries = variantIds
    .map((variantId) => {
      const index = captures.findIndex((capture) => text(capture.variantId) === variantId);
      const label = variantLabel.get(variantId) || variantId;
      const actions = [
        ...new Set(
          captures
            .filter((capture) => text(capture.variantId) === variantId)
            .map((capture) => {
              const matches = findings
                .filter((finding) => {
                  if (text(finding.runId) !== text(capture.runId)) return false;
                  const captureId = text(finding.captureId);
                  return (
                    captureId === text(capture.id) ||
                    captureReviewIdMatchesFrame(
                      captureId,
                      text(capture.framePath),
                      text(capture.imageSha256),
                    )
                  );
                })
                .sort(
                  (left, right) =>
                    Number(right.decidedAt) - Number(left.decidedAt) ||
                    Number(right.reviewVersion) - Number(left.reviewVersion),
                );
              return matches[0] ? text(matches[0].action) : "";
            })
            .filter(Boolean),
        ),
      ];
      const summary = actions.map((action) => escapeHtml(action)).join(", ");
      const missingTitles = listed
        .parse(manifest.missing)
        .filter((entry) => text(entry.variantId) === variantId)
        .map((entry) => stateTitle.get(text(entry.stateId)) || text(entry.stateId))
        .filter(Boolean)
        .map((title) => escapeHtml(title));
      const missingLabel = missingTitles.length ? ` · missing ${missingTitles.join(", ")}` : "";
      const textLabel = `${escapeHtml(label)}${summary ? ` · ${summary}` : ""}${missingLabel}`;
      return index >= 0
        ? `<li><a href="#capture-${index}">${textLabel}</a></li>`
        : `<li>${textLabel}</li>`;
    })
    .join("");
  const implied = variantIds
    .flatMap((variantId) =>
      listed.parse(manifest.states).flatMap((state) => {
        const stateId = text(state.id);
        if (!stateId) return [];
        const captured = captures.some(
          (capture) => text(capture.variantId) === variantId && text(capture.stateId) === stateId,
        );
        const recordedMissing = listed
          .parse(manifest.missing)
          .some((entry) => text(entry.variantId) === variantId && text(entry.stateId) === stateId);
        if (captured || recordedMissing) return [];
        const variant = variantLabel.get(variantId) || variantId;
        const title = text(state.title) || stateId;
        return [`<li>Not captured · ${escapeHtml(variant)} · ${escapeHtml(title)}</li>`];
      }),
    )
    .join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Recorded walkthrough</title><style>body{font-family:system-ui,sans-serif;margin:24px}.stage{position:relative;display:inline-block}img{max-width:100%;height:auto}.hotspot{position:absolute;transform:translate(-50%,-50%)}.hotspot.region{transform:none}section{display:none}section:target{display:block}body:not(:has(section:target)) section:first-of-type{display:block}</style></head><body><p>Recorded evidence. This file does not contact the tested application. A downloaded copy cannot be recalled.</p>${identity}<nav aria-label="Configurations"><ul>${entries}</ul></nav>${sections}<h2>Missing</h2><ul>${missing}${implied}</ul></body></html>`;
}

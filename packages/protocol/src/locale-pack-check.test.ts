import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { checkLocalePack } from "./locale-pack-check.js";

async function writeLocale(
  dir: string,
  name: string,
  body: Record<string, unknown>,
): Promise<void> {
  await writeFile(join(dir, "accessibility", name), `${JSON.stringify(body, null, 2)}\n`);
}

test("a locale missing a baseline slot is incomplete and not ok", async () => {
  const dir = await mkdtemp(join(tmpdir(), "relay-locale-pack-check-"));
  await mkdir(join(dir, "accessibility"));
  try {
    await writeLocale(dir, "data-controls-en.json", {
      locale: "en",
      slots: {
        found: [
          { id: "grok_data_controls", label: "Data Controls" },
          { id: "grok_delete_account", label: "Delete Account" },
        ],
        missing: [],
        complete: true,
      },
      strings: ["Data Controls", "Delete Account", "Grok", "Imagine"],
    });
    await writeLocale(dir, "data-controls-he.json", {
      locale: "he",
      slots: {
        found: [{ id: "grok_data_controls", label: "Data Controls" }],
        missing: ["grok_delete_account"],
        complete: false,
      },
      strings: ["Data Controls", "Delete Account", "Grok", "Imagine"],
    });

    const report = await checkLocalePack(dir, "en");

    assert.equal(report.ok, false);
    assert.equal(report.baseline, "en");
    assert.deepEqual(report.locales, ["en", "he"]);
    assert.deepEqual(
      report.findings.filter((finding) => finding.code === "missing-slot"),
      [
        {
          locale: "he",
          code: "missing-slot",
          detail: "Missing baseline slot grok_delete_account",
          slotId: "grok_delete_account",
        },
      ],
    );
    assert.deepEqual(
      report.digest.find((row) => row.locale === "he"),
      {
        locale: "he",
        complete: false,
        missingSlots: ["grok_delete_account"],
        leftoverEnglish: ["Data Controls", "Delete Account"],
      },
    );
    assert.equal(
      report.findings.some(
        (finding) => finding.code === "leftover-english" && finding.string === "Grok",
      ),
      false,
    );
    assert.equal(
      report.findings.some(
        (finding) => finding.code === "leftover-english" && finding.string === "Imagine",
      ),
      false,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a complete locale with only brand English is ok", async () => {
  const dir = await mkdtemp(join(tmpdir(), "relay-locale-pack-ok-"));
  await mkdir(join(dir, "accessibility"));
  try {
    await writeLocale(dir, "data-controls-en.json", {
      locale: "en",
      slots: {
        found: [{ id: "grok_delete_account", label: "Delete Account" }],
        complete: true,
      },
      strings: ["Delete Account", "Grok"],
    });
    await writeLocale(dir, "data-controls-ja.json", {
      locale: "ja",
      slots: {
        found: [{ id: "grok_delete_account", label: "アカウントを削除" }],
        complete: true,
      },
      strings: ["アカウントを削除", "Grok"],
    });

    const report = await checkLocalePack(dir, "en");

    assert.equal(report.ok, true);
    assert.deepEqual(report.findings, []);
    assert.equal(report.digest.find((row) => row.locale === "ja")?.complete, true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a combine-export tree uses <locale>/accessibility/*.json", async () => {
  const dir = await mkdtemp(join(tmpdir(), "relay-locale-pack-export-"));
  try {
    await mkdir(join(dir, "en", "accessibility"), { recursive: true });
    await mkdir(join(dir, "he", "accessibility"), { recursive: true });
    await writeFile(
      join(dir, "en", "accessibility", "001-001.json"),
      `${JSON.stringify({
        schemaVersion: 1,
        kind: "relay.frame-tree",
        nodes: [{ label: "Data Controls" }, { label: "Delete Account" }, { label: "Grok" }],
      })}\n`,
    );
    await writeFile(
      join(dir, "he", "accessibility", "001-001.json"),
      `${JSON.stringify({
        schemaVersion: 1,
        kind: "relay.frame-tree",
        nodes: [{ label: "בקרת נתונים" }, { label: "Grok" }],
      })}\n`,
    );

    const report = await checkLocalePack(dir, "en");

    assert.equal(report.ok, true);
    assert.deepEqual(report.locales, ["en", "he"]);
    assert.deepEqual(report.digest.find((row) => row.locale === "he")?.leftoverEnglish, []);
    assert.equal(
      report.findings.some(
        (finding) => finding.code === "leftover-english" && finding.string === "Grok",
      ),
      false,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a locale-named tree at the pack root is accepted", async () => {
  const dir = await mkdtemp(join(tmpdir(), "relay-locale-pack-root-"));
  try {
    await writeFile(
      join(dir, "en.json"),
      `${JSON.stringify({
        nodes: [{ label: "Data Controls" }, { label: "Grok" }],
      })}\n`,
    );
    await writeFile(
      join(dir, "ja.json"),
      `${JSON.stringify({
        snapshot: { nodes: [{ label: "データ管理" }, { label: "Grok" }] },
      })}\n`,
    );

    const report = await checkLocalePack(dir, "en");

    assert.equal(report.ok, true);
    assert.deepEqual(report.locales, ["en", "ja"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

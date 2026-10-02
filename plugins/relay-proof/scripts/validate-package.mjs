import assert from "node:assert/strict";
import { lstat, readFile, readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Self-contained: this validator also runs from a copied artifact.
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const json = async (path) => JSON.parse(await readFile(join(root, path), "utf8"));
const portable = await json("plugin.json");
const compatibility = await json(".codex-plugin/plugin.json");
assert.equal(portable.name, "relay-proof");
assert.match(portable.version, /^\d+\.\d+\.\d+$/u);
for (const key of ["name", "version", "description"]) {
  assert.equal(portable[key], compatibility[key], `${key} differs between manifests`);
}
assert.deepEqual(portable.extensions["com.openai"].interface, compatibility.interface);
assert.ok(compatibility.interface.shortDescription.length <= 30);
assert.equal(compatibility.interface.displayName, "Relay");
for (const key of ["skills", "mcpServers", "apps", "interface"]) {
  assert.equal(Object.hasOwn(portable, key), false, `portable manifest has ${key}`);
}
const mcp = await json("mcp.json");
const legacy = await json(".mcp.json");
const claude = await json("hosts/claude-code/.mcp.json");
const { type, ...entry } = mcp.mcpServers.relay;
assert.equal(type, "stdio");
assert.deepEqual(entry, legacy.mcpServers.relay);
assert.deepEqual(entry, claude.mcpServers.relay);
assert.equal(entry.command, "relay-mcp");
assert.deepEqual(entry.args, ["--profile", "qa"]);
assert.equal(entry.env.RELAY_MCP_PROFILE, "qa");
assert.equal(Object.hasOwn(entry.env, "RELAY_AUTH_TOKEN"), false);
for (const name of await readdir(join(root, "skills"))) {
  const source = await readFile(join(root, "skills", name, "SKILL.md"), "utf8");
  assert.match(source, new RegExp(`^---\\nname: ${name}\\ndescription: .+\\n---`, "u"));
  assert.doesNotMatch(source, /\/Users\/|packages\/.*\/src\//u);
}
async function checkFiles(directory) {
  for (const name of await readdir(directory)) {
    const path = join(directory, name);
    const stat = await lstat(path);
    assert.equal(stat.isSymbolicLink(), false, `distribution symlink: ${path}`);
    if (stat.isDirectory()) await checkFiles(path);
  }
}
await checkFiles(root);
console.log(
  `Relay ${portable.version}: portable and compatibility manifests, QA transport and skills valid`,
);

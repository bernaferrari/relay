import { access, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const readmePath = resolve(repositoryRoot, "README.md");
const packagePath = resolve(repositoryRoot, "package.json");
const publicContractCandidates = [
  "docs/PRODUCT_FLOWS.md",
  "docs/RECORDING_FORMAT.md",
  "docs/ENTERPRISE_READINESS.md",
  "docs/OPENCODE_REFERENCE.md",
  "packages/mcp/README.md",
];

function bashBlocks(markdown) {
  return [...markdown.matchAll(/```bash\s*\n([\s\S]*?)```/g)].map((match) => match[1]);
}

function localLinks(markdown) {
  return [...markdown.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)]
    .map((match) => match[1].trim())
    .filter((target) => target.startsWith("./"))
    .map((target) => target.split("#", 1)[0]);
}

function documentedPnpmScripts(markdown) {
  const scripts = new Set();
  for (const block of bashBlocks(markdown)) {
    for (const line of block.split("\n")) {
      const command = line.trim().match(/^pnpm\s+(?!run\s+|--filter\s+|exec\s+)([^\s\\]+)/)?.[1];
      if (command) scripts.add(command);
      const runCommand = line.trim().match(/^pnpm\s+run\s+([^\s\\]+)/)?.[1];
      if (runCommand) scripts.add(runCommand);
    }
  }
  return scripts;
}

const readme = await readFile(readmePath, "utf8");
const packageSource = await readFile(packagePath, "utf8");
const publicContractPaths = [];
const publicContracts = [];
for (const path of publicContractCandidates) {
  try {
    publicContracts.push(await readFile(resolve(repositoryRoot, path), "utf8"));
    publicContractPaths.push(path);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}
const packageJson = JSON.parse(packageSource);
const violations = [];

for (const link of localLinks(readme)) {
  try {
    await access(resolve(repositoryRoot, link));
  } catch {
    violations.push(`README.md links to missing file: ${link}`);
  }
}

for (const command of documentedPnpmScripts(readme)) {
  if (!packageJson.scripts?.[command]) {
    violations.push(`README.md documents missing root script: pnpm ${command}`);
  }
}

for (const block of bashBlocks(readme)) {
  if (/^relay\s+/m.test(block)) {
    violations.push("README.md uses bare `relay`; use the verified `pnpm relay` workspace entry.");
  }
}

const legacyPublicTerms = [
  [
    /(?:\brecipes?\b|recipes? settings|saved journeys?|\bjourney\b|discovery\.journey|\/journey\b|state[- ]?sets?|option[- ]?sets?|run[- ]?matrices?|\bcombo\b|modifier values)/iu,
    "legacy product vocabulary",
  ],
  [/\b\d+-operation\s+`?full`?\s+catalog/iu, "a hard-coded operation catalog count"],
];
for (const [index, source] of publicContracts.entries()) {
  for (const [pattern, label] of legacyPublicTerms) {
    if (pattern.test(source)) {
      violations.push(`${publicContractPaths[index]} contains ${label}`);
    }
  }
}

if (violations.length) {
  console.error("Documentation verification failed:");
  for (const violation of violations) console.error(`- ${violation}`);
  process.exitCode = 1;
} else {
  console.log(
    `Documentation verification passed: ${localLinks(readme).length} local links, ${documentedPnpmScripts(readme).size} root commands, and ${publicContractPaths.length} public contracts checked.`,
  );
}

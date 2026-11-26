import { execFileSync } from "node:child_process";
import { access, readFile, readdir } from "node:fs/promises";
import { dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const readmePath = resolve(repositoryRoot, "README.md");
const packagePath = resolve(repositoryRoot, "package.json");
const markdownRoots = ["docs", "advisor-plans"];
const additionalMarkdownFiles = ["README.md", "packages/mcp/README.md"];
const publicContractCandidates = [
  "docs/PRODUCT_FLOWS.md",
  "docs/RECORDING_FORMAT.md",
  "docs/ENTERPRISE_READINESS.md",
  "docs/OPENCODE_REFERENCE.md",
  "packages/mcp/README.md",
];

function markdownWithoutCode(markdown) {
  return markdown.replace(/```[\s\S]*?```/g, "").replace(/`[^`\n]*`/g, "");
}

function bashBlocks(markdown) {
  return [...markdown.matchAll(/```bash\s*\n([\s\S]*?)```/g)].map((match) => match[1]);
}

export function localMarkdownLinks(markdown) {
  return [...markdownWithoutCode(markdown).matchAll(/\[[^\]]*\]\(([^)]+)\)/g)]
    .map((match) => match[1].trim().split(/\s+/u, 1)[0])
    .filter((target) => target && !/^(?:[a-z][a-z0-9+.-]:)?\/\//iu.test(target))
    .filter((target) => !/^(?:[a-z][a-z0-9+.-]*:|#)/iu.test(target))
    .filter((target) => !target.startsWith("/"))
    .map((target) => target.split("#", 1)[0])
    .filter(Boolean);
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

async function markdownFiles(directory) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await markdownFiles(path)));
    else if ([".md", ".mdx"].includes(extname(entry.name))) files.push(path);
  }
  return files;
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

const checkedMarkdownPaths = new Set(additionalMarkdownFiles);
for (const root of markdownRoots) {
  for (const path of await markdownFiles(resolve(repositoryRoot, root))) {
    checkedMarkdownPaths.add(relative(repositoryRoot, path));
  }
}

let checkedLocalLinkCount = 0;
for (const path of checkedMarkdownPaths) {
  const absolutePath = resolve(repositoryRoot, path);
  let markdown;
  try {
    markdown = await readFile(absolutePath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") continue;
    throw error;
  }
  for (const link of localMarkdownLinks(markdown)) {
    checkedLocalLinkCount += 1;
    try {
      await access(resolve(dirname(absolutePath), decodeURIComponent(link)));
    } catch {
      violations.push(`${path} links to missing file: ${link}`);
    }
  }
}

// HTML images and picture sources must ship with the README, too. Local
// ignored assets can look fine on the author's machine while breaking on GitHub.
const readmeImages = [...readme.matchAll(/<(?:img|source)\b[^>]*\b(?:src|srcset)="([^"]+)"/g)]
  .flatMap((match) => match[1].split(",").map((source) => source.trim().split(/\s+/)[0]))
  .filter((source) => source.startsWith("./"));
for (const image of new Set(readmeImages)) {
  try {
    await access(resolve(repositoryRoot, image));
  } catch {
    violations.push(`README.md references missing image: ${image}`);
    continue;
  }
  try {
    execFileSync("git", ["check-ignore", "--quiet", "--", image], { cwd: repositoryRoot });
    violations.push(`README.md image is ignored by Git: ${image}`);
  } catch (error) {
    if (error.status !== 1) throw error;
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
    `Documentation verification passed: ${checkedLocalLinkCount} local links across ${checkedMarkdownPaths.size} Markdown files, ${documentedPnpmScripts(readme).size} root commands, and ${publicContractPaths.length} public contracts checked.`,
  );
}

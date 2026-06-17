/**
 * seed-source-packs.ts
 *
 * Queries the GitHub Search API for repos tagged with agent-skill / MCP topics
 * and writes candidate entries to discover/source-packs/community.json.
 *
 * Usage:
 *   npx tsx scripts/seed-source-packs.ts [--auto-approve] [--dry-run]
 *
 * Flags:
 *   --auto-approve  Append candidates directly without prompting (CI-safe).
 *   --dry-run       Print candidates to stdout only; do not write any files.
 *
 * Environment:
 *   GITHUB_TOKEN    Optional PAT. Without it the script uses unauthenticated
 *                   GitHub API (60 req/h). With a token: 5,000 req/h.
 *
 * The script:
 *   1. Searches GitHub for repos with topic:claude-skill, topic:mcp-server,
 *      topic:agent-harness, and topic:cursor-rules (min 10 stars, public).
 *   2. Filters out repos already present in sources.json or the source packs.
 *   3. Infers authorityTier, assetKinds, and hosts from repo metadata.
 *   4. Writes new entries to discover/source-packs/community.json (or prints
 *      them when --dry-run is set).
 */

import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SourcePackEntry {
  id: string;
  name: string;
  repo: string;
  kind: "repo";
  authorityTier: string;
  publisher: string;
  publisherVerified: boolean;
  hosts: string[];
  assetKinds: string[];
  priority: number;
  enabled: boolean;
  description?: string;
}

interface SourcePack {
  schemaVersion: number;
  entries: SourcePackEntry[];
}

interface GitHubRepo {
  full_name: string;
  html_url: string;
  description: string | null;
  stargazers_count: number;
  topics: string[];
  owner: { login: string; type: string };
  license: { spdx_id: string } | null;
  pushed_at: string;
  default_branch: string;
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const REPO_ROOT = join(import.meta.dirname, "..");
const COMMUNITY_PACK_PATH = join(
  REPO_ROOT,
  "discover",
  "source-packs",
  "community.json",
);
const SOURCES_PATH = join(REPO_ROOT, "discover", "sources.json");
const OFFICIAL_PACK_PATH = join(
  REPO_ROOT,
  "discover",
  "source-packs",
  "official.json",
);

const TOPICS = [
  "claude-skill",
  "mcp-server",
  "agent-harness",
  "cursor-rules",
  "agent-skill",
];
const MIN_STARS = 10;
const MAX_RESULTS_PER_TOPIC = 100;

// ---------------------------------------------------------------------------
// GitHub API helpers
// ---------------------------------------------------------------------------

const GITHUB_TOKEN = process.env["GITHUB_TOKEN"] ?? "";

async function githubSearch(topic: string, page = 1): Promise<GitHubRepo[]> {
  const url = new URL("https://api.github.com/search/repositories");
  url.searchParams.set("q", `topic:${topic} stars:>=${MIN_STARS} is:public`);
  url.searchParams.set("sort", "stars");
  url.searchParams.set("order", "desc");
  url.searchParams.set("per_page", "100");
  url.searchParams.set("page", String(page));

  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (GITHUB_TOKEN) {
    headers["Authorization"] = `Bearer ${GITHUB_TOKEN}`;
  }

  const response = await fetch(url.toString(), { headers });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `GitHub API error ${response.status} for topic:${topic}: ${body}`,
    );
  }
  const data = (await response.json()) as { items: GitHubRepo[] };
  return data.items ?? [];
}

// ---------------------------------------------------------------------------
// Inference helpers
// ---------------------------------------------------------------------------

function inferAuthorityTier(repo: GitHubRepo): string {
  const stargazers = repo.stargazers_count;
  const orgType = repo.owner.type;
  const org = repo.owner.login.toLowerCase();

  const OFFICIAL_ORGS = new Set([
    "anthropics",
    "openai",
    "microsoft",
    "google",
    "googlecloudplatform",
    "aws",
    "awslabs",
    "amazon",
    "meta-llama",
    "nvidia",
    "mistralai",
    "cohere-ai",
    "huggingface",
  ]);

  if (OFFICIAL_ORGS.has(org)) return "official-first-party";
  if (orgType === "Organization" && stargazers >= 500)
    return "trusted-community";
  if (stargazers >= 100) return "trusted-community";
  return "unverified-community";
}

function inferAssetKinds(repo: GitHubRepo): string[] {
  const topics = repo.topics.map((t) => t.toLowerCase());
  const desc = (repo.description ?? "").toLowerCase();

  const kinds: Set<string> = new Set();

  if (
    topics.includes("mcp-server") ||
    topics.includes("mcp") ||
    desc.includes("mcp server") ||
    desc.includes("model context protocol")
  ) {
    kinds.add("mcp-server");
  }
  if (
    topics.includes("claude-skill") ||
    topics.includes("agent-skill") ||
    desc.includes("skill.md") ||
    desc.includes("agent skill")
  ) {
    kinds.add("skill");
  }
  if (topics.includes("cursor-rules") || desc.includes(".cursorrules")) {
    kinds.add("instruction");
  }
  if (topics.includes("agent-harness") || desc.includes("agent harness")) {
    kinds.add("skill");
    kinds.add("workflow");
  }
  if (kinds.size === 0) {
    kinds.add("skill");
    kinds.add("reference-pack");
  }
  return [...kinds];
}

function inferHosts(repo: GitHubRepo): string[] {
  const topics = repo.topics.map((t) => t.toLowerCase());
  const desc = (repo.description ?? "").toLowerCase();

  const hosts: Set<string> = new Set();

  if (topics.includes("claude-code") || desc.includes("claude code")) {
    hosts.add("claude-code");
  }
  if (topics.includes("cursor") || topics.includes("cursor-rules")) {
    hosts.add("cursor");
  }
  if (topics.includes("copilot") || desc.includes("github copilot")) {
    hosts.add("copilot-vscode");
  }
  if (topics.includes("opencode")) {
    hosts.add("opencode");
  }
  if (
    topics.includes("mcp-server") ||
    topics.includes("mcp") ||
    desc.includes("model context protocol")
  ) {
    hosts.add("shared");
  }
  if (hosts.size === 0) {
    hosts.add("claude-code");
    hosts.add("cursor");
    hosts.add("copilot-vscode");
    hosts.add("opencode");
  }
  return [...hosts];
}

function inferPriority(repo: GitHubRepo): number {
  const tier = inferAuthorityTier(repo);
  if (tier === "official-first-party") return 92;
  if (tier === "trusted-community") return 74;
  return 60;
}

function repoToId(repo: GitHubRepo): string {
  return `${repo.owner.login.toLowerCase()}-${repo.full_name
    .split("/")[1]!
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")}`;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const { values: flags } = parseArgs({
  options: {
    "auto-approve": { type: "boolean", default: false },
    "dry-run": { type: "boolean", default: false },
  },
});

const isDryRun = flags["dry-run"] ?? false;

// Load existing IDs to deduplicate
const communityPack = JSON.parse(
  await readFile(COMMUNITY_PACK_PATH, "utf8"),
) as SourcePack;
const officialPack = JSON.parse(
  await readFile(OFFICIAL_PACK_PATH, "utf8"),
) as SourcePack;
const sourcesRaw = JSON.parse(await readFile(SOURCES_PATH, "utf8")) as {
  sources: Array<{ id: string; kind?: string; publisher?: { url?: string } }>;
};

const existingIds = new Set([
  ...communityPack.entries.map((e) => e.id),
  ...officialPack.entries.map((e) => e.id),
  ...sourcesRaw.sources.map((s) => s.id),
]);

// Collect candidates from all topics
const seen = new Set<string>();
const candidates: SourcePackEntry[] = [];

for (const topic of TOPICS) {
  console.log(`Searching topic:${topic} ...`);
  const repos = await githubSearch(topic);
  let added = 0;

  for (const repo of repos.slice(0, MAX_RESULTS_PER_TOPIC)) {
    const repoKey = repo.full_name.toLowerCase();
    if (seen.has(repoKey)) continue;
    seen.add(repoKey);

    const id = repoToId(repo);
    if (existingIds.has(id)) continue;

    // Skip repos with restrictive licenses
    const spdx = repo.license?.spdx_id ?? "";
    if (spdx === "NOASSERTION" || spdx === "UNLICENSED") continue;

    candidates.push({
      id,
      name: repo.full_name
        .split("/")[1]!
        .replace(/-/g, " ")
        .replace(/\b\w/g, (c) => c.toUpperCase()),
      repo: repo.html_url,
      kind: "repo",
      authorityTier: inferAuthorityTier(repo),
      publisher: repo.owner.login,
      publisherVerified: false,
      hosts: inferHosts(repo),
      assetKinds: inferAssetKinds(repo),
      priority: inferPriority(repo),
      enabled: true,
      ...(repo.description ? { description: repo.description } : {}),
    });
    added++;
  }
  console.log(`  → ${added} new candidates`);
}

console.log(`\nTotal new candidates: ${candidates.length}`);

if (candidates.length === 0) {
  console.log("Nothing to add.");
  process.exit(0);
}

if (isDryRun) {
  console.log("\n--- DRY RUN: candidates (not written) ---");
  console.log(JSON.stringify(candidates, null, 2));
  process.exit(0);
}

// Append to community.json
communityPack.entries.push(...candidates);
await writeFile(
  COMMUNITY_PACK_PATH,
  JSON.stringify(communityPack, null, 2) + "\n",
);
console.log(
  `\nWrote ${candidates.length} new entries to discover/source-packs/community.json`,
);
console.log(`Total community entries: ${communityPack.entries.length}`);

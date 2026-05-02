import { fetchTextWithGuards } from "./lib/http.js";
import type { AssetStatus, AuthorityTier } from "./types.js";

const OFFICIAL_INDEX_USER_AGENT = "agent-harness";
const MAX_LIST_ITEMS = 5;
const MAX_OFFICIAL_INDEX_PAGE_BYTES = 1_000_000;
const OFFICIAL_INDEX_ALLOWED_ORIGINS = [
  "https://officialskills.sh",
  "https://raw.githubusercontent.com",
  "https://docs.github.com",
  "https://docs.anthropic.com",
  "https://modelcontextprotocol.io",
  "https://skills.sh",
  "https://marketplace.visualstudio.com",
] as const;

export async function fetchOfficialIndexPageContent(
  url: string,
): Promise<string | null> {
  const html = await fetchTextWithGuards(url, {
    allowedOrigins: OFFICIAL_INDEX_ALLOWED_ORIGINS,
    headers: {
      "User-Agent": OFFICIAL_INDEX_USER_AGENT,
    },
    maxBytes: MAX_OFFICIAL_INDEX_PAGE_BYTES,
  });
  if (html === null) {
    return null;
  }

  const extractedContent = extractOfficialIndexPageSummary(html, url);
  return extractedContent.length > 0 ? extractedContent : null;
}

export function buildOfficialIndexAssetStatus(
  authorityTier: AuthorityTier,
): AssetStatus {
  const isPromotableOfficialEntry = authorityTier === "official-first-party";

  return {
    cataloged: true,
    mirrorEligible: isPromotableOfficialEntry,
    installEligible: isPromotableOfficialEntry,
    activationEligible: isPromotableOfficialEntry,
  };
}

function extractOfficialIndexPageSummary(html: string, url: string): string {
  const title = extractTitle(html);
  const description = extractMetaDescription(html);
  const installCommand = extractInstallCommand(html);
  const githubUrl = extractGitHubUrl(html, installCommand);
  const skillSummary = extractSectionParagraph("What This Skill Does", html);
  const whyItHelps = extractWhyItHelps(html);
  const useCases = extractSectionListItems("When to use it", html);

  const lines = [
    `# ${title ?? "Official skill"}`,
    "",
    `**Official Page**: ${url}`,
    githubUrl ? `**GitHub**: ${githubUrl}` : "",
    "",
    "## Core Concept",
    skillSummary ??
      description ??
      "No concise summary was available from the official index page.",
    whyItHelps ? "" : "",
    whyItHelps ? "## Why It Helps" : "",
    whyItHelps ?? "",
    "",
    "## Key Points",
    ...buildKeyPoints({ description, installCommand, githubUrl, useCases }),
    "",
    "## Quick Example",
    "```bash",
    installCommand ?? `npx skills add ${githubUrl ?? url}`,
    "```",
  ].filter((line) => line.length > 0);

  return `${lines.join("\n").trim()}\n`;
}

function buildKeyPoints(input: {
  description: string | null;
  installCommand: string | null;
  githubUrl: string | null;
  useCases: string[];
}): string[] {
  const points: string[] = [];

  if (input.description) {
    points.push(`- ${input.description}`);
  }

  if (input.installCommand) {
    points.push(
      "- Installable directly with the official `npx skills add` flow.",
    );
  }

  if (input.githubUrl) {
    points.push(
      "- Backed by a linked GitHub repository for deeper inspection and updates.",
    );
  }

  for (const useCase of input.useCases.slice(0, MAX_LIST_ITEMS)) {
    points.push(`- ${useCase}`);
  }

  return points.length > 0
    ? points
    : ["- Official index entry mirrored as structured summary."];
}

function extractTitle(html: string): string | null {
  const titleMatch = /<title>(.*?)<\/title>/iu.exec(html);
  const rawTitle = cleanHtmlText(titleMatch?.[1] ?? "");
  return (
    rawTitle?.replace(/\s+—\s+Agent Skills\s+\|\s+officialskills\.sh$/iu, "") ??
    null
  );
}

function extractMetaDescription(html: string): string | null {
  const descriptionMatch =
    /<meta\s+name="description"\s+content="([^"]+)"/iu.exec(html);
  return cleanHtmlText(descriptionMatch?.[1] ?? "");
}

function extractInstallCommand(html: string): string | null {
  const commandMatch = /npx skills add[^<]{0,300}?--skill\s+[a-z0-9-]+/iu.exec(
    html,
  );
  return cleanHtmlText(commandMatch?.[0] ?? "");
}

function extractGitHubUrl(
  html: string,
  installCommand: string | null,
): string | null {
  const installCommandRepositoryUrl =
    /npx skills add\s+(https:\/\/github\.com\/[^\s]+)\s+--skill/iu.exec(
      installCommand ?? "",
    )?.[1];
  if (installCommandRepositoryUrl) {
    return installCommandRepositoryUrl;
  }

  const viewOnGitHubMatch =
    /<a href="(https:\/\/github\.com\/[^"]+)"[^>]*>.*?View on GitHub<\/a>/iu.exec(
      html,
    );
  if (viewOnGitHubMatch?.[1]) {
    return cleanHtmlText(viewOnGitHubMatch[1]);
  }

  const githubLinks = [...html.matchAll(/https:\/\/github\.com\/[^"\s<]+/giu)]
    .map((match) => cleanHtmlText(match[0] ?? ""))
    .filter((value): value is string => Boolean(value && value.length > 0));

  return githubLinks[0] ?? null;
}

function extractSectionParagraph(heading: string, html: string): string | null {
  const sectionContent = extractSectionContent(heading, html);
  if (!sectionContent) {
    return null;
  }

  const paragraphMatch = /<p[^>]*>(.*?)<\/p>/iu.exec(sectionContent);
  return cleanHtmlText(paragraphMatch?.[1] ?? "");
}

function extractWhyItHelps(html: string): string | null {
  const sectionContent = extractSectionContent("What This Skill Does", html);
  if (!sectionContent) {
    return null;
  }

  const paragraphMatches = [...sectionContent.matchAll(/<p[^>]*>(.*?)<\/p>/giu)]
    .map((match) => cleanHtmlText(match[1] ?? ""))
    .filter((value): value is string => Boolean(value && value.length > 0));

  return paragraphMatches[1] ?? null;
}

function extractSectionListItems(heading: string, html: string): string[] {
  const sectionContent = extractSectionContent(heading, html);
  if (!sectionContent) {
    return [];
  }

  return [...sectionContent.matchAll(/<li[^>]*>(.*?)<\/li>/giu)]
    .map((match) => cleanHtmlText(match[1] ?? ""))
    .filter((value): value is string => Boolean(value && value.length > 0));
}

function extractSectionContent(heading: string, html: string): string | null {
  const escapedHeading = escapeRegExp(heading);
  const sectionMatch = new RegExp(
    `<h2[^>]*>${escapedHeading}<\\/h2>([\\s\\S]*?)<\\/section>`,
    "iu",
  ).exec(html);
  if (sectionMatch?.[1]) {
    return sectionMatch[1];
  }

  const fallbackMatch = new RegExp(
    `<h3[^>]*>${escapedHeading}<\\/h3>([\\s\\S]*?)(?:<h[23]|<\\/section>)`,
    "iu",
  ).exec(html);
  return fallbackMatch?.[1] ?? null;
}

function cleanHtmlText(value: string): string | null {
  const cleanedValue = decodeHtmlEntities(
    value
      .replace(/<[^>]+>/gu, " ")
      .replace(/\s+/gu, " ")
      .trim(),
  );

  return cleanedValue.length > 0 ? cleanedValue : null;
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&amp;/gu, "&")
    .replace(/&quot;/gu, '"')
    .replace(/&#x27;/gu, "'")
    .replace(/&#39;/gu, "'")
    .replace(/&lt;/gu, "<")
    .replace(/&gt;/gu, ">")
    .replace(/&nbsp;/gu, " ");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

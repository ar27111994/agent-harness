import { join } from "node:path";

import { readJsonFileOrNull, writeJsonFile } from "../../files.js";
import type { AuthorityTier, SourceDefinition } from "../../types.js";

interface OfficialUpstreamsConfig {
  owners?: Record<string, string[]>;
}

export interface SourceVerificationEntry {
  sourceId: string;
  originalAuthorityTier: AuthorityTier;
  effectiveAuthorityTier: AuthorityTier;
  verified: boolean;
  reasons: string[];
  evidence: {
    publisherVerified: boolean;
    publisherOwner?: string;
    repoOwner?: string;
    docsHost?: string;
    matchedAllowlistOwner?: string;
  };
}

export interface SourceVerificationReport {
  schemaVersion: number;
  generatedAt: string;
  checkedSourceCount: number;
  demotedSourceCount: number;
  entries: SourceVerificationEntry[];
}

/**
 * Writes official source verification report and deterministic trust demotions.
 */
export async function writeSourceVerificationReport(
  projectRoot: string,
  sources: SourceDefinition[],
): Promise<SourceVerificationReport> {
  const report = await buildSourceVerificationReport(projectRoot, sources);
  await writeJsonFile(
    join(projectRoot, "discover", "output", "source-verification.json"),
    report,
  );
  return report;
}

/**
 * Builds official source verification report and deterministic trust demotions.
 */
export async function buildSourceVerificationReport(
  projectRoot: string,
  sources: SourceDefinition[],
): Promise<SourceVerificationReport> {
  const officialUpstreams =
    (
      await readJsonFileOrNull<OfficialUpstreamsConfig>(
        join(projectRoot, "discover", "official-upstreams.json"),
      )
    )?.owners ?? {};
  const entries = sources.map((source) =>
    verifySourceAuthority(source, officialUpstreams),
  );

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    checkedSourceCount: entries.length,
    demotedSourceCount: entries.filter(
      (entry) => entry.effectiveAuthorityTier !== entry.originalAuthorityTier,
    ).length,
    entries,
  };
}

/**
 * Applies deterministic source trust demotions without mutating source definitions.
 */
export function applySourceVerificationDemotions(
  sources: SourceDefinition[],
  report: SourceVerificationReport,
): SourceDefinition[] {
  const effectiveTierBySourceId = new Map(
    report.entries.map((entry) => [
      entry.sourceId,
      entry.effectiveAuthorityTier,
    ]),
  );

  return sources.map((source) => ({
    ...source,
    authorityTier:
      effectiveTierBySourceId.get(source.id) ?? source.authorityTier,
  }));
}

export function verifySourceAuthority(
  source: SourceDefinition,
  officialUpstreams: Record<string, string[]>,
): SourceVerificationEntry {
  const publisherOwner = source.publisher?.owner?.toLowerCase();
  const repoOwner = getGitHubRepoOwner(source.endpoints.repo)?.toLowerCase();
  const docsHost = getUrlHost(source.endpoints.docsUrl);
  const matchedAllowlistOwner = findMatchedAllowlistOwner(
    repoOwner,
    officialUpstreams,
  );
  const matchedPublisherAllowlistOwner = findMatchedAllowlistOwner(
    publisherOwner,
    officialUpstreams,
  );
  const reasons: string[] = [];
  let effectiveAuthorityTier = source.authorityTier;

  if (source.authorityTier === "official-first-party") {
    if (!source.publisher?.verified) {
      reasons.push("official source publisher is not marked verified");
    }

    if (source.kind === "repo") {
      if (!matchedAllowlistOwner) {
        reasons.push(
          "official repo owner is not present in official-upstreams allowlist",
        );
      }
      if (publisherOwner && repoOwner && publisherOwner !== repoOwner) {
        reasons.push("official repo owner does not match publisher owner");
      }
    }

    if (
      source.kind === "docs" &&
      !matchedPublisherAllowlistOwner &&
      !isOfficialDocsHostForPublisher(docsHost, publisherOwner)
    ) {
      reasons.push(
        "official docs host does not match publisher or allowlist evidence",
      );
    }

    if (reasons.length > 0) {
      effectiveAuthorityTier = "official-compatible";
    }
  }

  return {
    sourceId: source.id,
    originalAuthorityTier: source.authorityTier,
    effectiveAuthorityTier,
    verified: reasons.length === 0,
    reasons,
    evidence: {
      publisherVerified: source.publisher?.verified ?? false,
      publisherOwner,
      repoOwner,
      docsHost,
      matchedAllowlistOwner:
        matchedAllowlistOwner ?? matchedPublisherAllowlistOwner,
    },
  };
}

function findMatchedAllowlistOwner(
  owner: string | undefined,
  officialUpstreams: Record<string, string[]>,
): string | undefined {
  if (!owner) {
    return undefined;
  }

  return Object.entries(officialUpstreams).find(([, allowedOwners]) =>
    allowedOwners.map((entry) => entry.toLowerCase()).includes(owner),
  )?.[0];
}

function getGitHubRepoOwner(repoUrl: string | undefined): string | undefined {
  if (!repoUrl) {
    return undefined;
  }

  const httpsMatch = /^https:\/\/github\.com\/([^/]+)\/[^/]+/iu.exec(repoUrl);
  if (httpsMatch?.[1]) {
    return httpsMatch[1];
  }

  const sshMatch = /^git@github\.com:([^/]+)\/[^/]+/iu.exec(repoUrl);
  return sshMatch?.[1];
}

function getUrlHost(urlValue: string | undefined): string | undefined {
  if (!urlValue) {
    return undefined;
  }

  try {
    return new URL(urlValue).host.toLowerCase();
  } catch {
    return undefined;
  }
}

function isOfficialDocsHostForPublisher(
  docsHost: string | undefined,
  publisherOwner: string | undefined,
): boolean {
  if (!docsHost || !publisherOwner) {
    return false;
  }

  return (
    docsHost === `${publisherOwner}.com` ||
    docsHost.endsWith(`.${publisherOwner}.com`)
  );
}

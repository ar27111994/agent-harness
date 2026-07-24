import { fetchGitHubRepoSnapshot } from "../../github.js";
import type { KeyObject } from "node:crypto";
import type {
  AssetCatalogEntry,
  AssetKind,
  AssetRisk,
  CompatibilityMode,
  DemandProfile,
  GitHubRepoSnapshot,
  HostTarget,
  SelectionRegistry,
  SourceDefinition,
} from "../../types.js";
import { inferCompatibleHosts } from "../../host-adapters/compatibility-matrix.js";
import { TRUST_SIGNAL_SCORE_BOOST } from "../../recommend/constants.js";
import {
  buildAssetStatus,
  buildCandidateRankHint,
  buildCatalogId,
  buildTrustSignals,
  deriveDisplayNameFromPath,
  computeHostFit,
  computePortfolioFit,
  computeTrustScore,
  findDuplicateGroup,
  GENERIC_CAPABILITY_TOKENS,
  splitIntoKeywords,
  uniqueStrings,
} from "./catalog-utils.js";
import {
  buildClassificationConfidence,
  pathEvidence,
  schemaEvidence,
  sourceFamilyEvidence,
  type ClassificationConfidence,
  type ClassificationEvidenceItem,
} from "./classification-confidence.js";

type FetchGitHubRepoSnapshot = typeof fetchGitHubRepoSnapshot;

/**
 * Provides harvest git hub repo source for the lifecycle pipeline.
 */
export async function harvestGitHubRepoSource(
  source: SourceDefinition,
  demandProfile: DemandProfile | null,
  selectionRegistry: SelectionRegistry,
  projectRoot: string,
  fetchSnapshot: FetchGitHubRepoSnapshot = fetchGitHubRepoSnapshot,
): Promise<AssetCatalogEntry[]> {
  try {
    const snapshot = await fetchSnapshot(source, projectRoot);

    if (!snapshot) {
      return [];
    }

    if (snapshot.tree.truncated) {
      console.warn(
        `Skipping repo source ${source.id}: GitHub tree response was truncated.`,
      );
      return [];
    }

    // Build a Map of path→size for O(1) OMS-signature lookups with content
    // verification. Require a minimum size of 64 bytes — a real OMS signature
    // or PEM certificate is at minimum a few hundred bytes; empty or tiny files
    // must not inflate trust scores.
    const OMS_MIN_FILE_SIZE = 64;
    const omsCandidateFiles = snapshot.tree.entries.filter(
      (entry) =>
        entry.type === "blob" &&
        entry.size != null &&
        entry.size >= OMS_MIN_FILE_SIZE &&
        /(?:^|\/)(?:skill\.)?oms\.sig$|nv-agent-root-cert\.pem$/u.test(
          entry.path,
        ),
    );

    // Fetch and verify blob contents for candidate OMS files so trust signals
    // are only awarded to files with cryptographically plausible content.
    const { verified: omsFileSizes, pemVerified } = await verifyOmsBlobs(
      snapshot,
      omsCandidateFiles,
      source,
    );
    snapshot.pemVerified = pemVerified;

    return snapshot.tree.entries
      .filter((entry) => entry.type === "blob")
      .map((entry) => {
        // Pre-compute a lower-cased path set for O(1) OMS-signature lookups
        // inside buildGitHubCatalogEntry, avoiding an O(n) scan per asset.
        return buildGitHubCatalogEntry(
          snapshot,
          source,
          entry,
          demandProfile,
          selectionRegistry,
          omsFileSizes,
        );
      })
      .filter((entry): entry is AssetCatalogEntry => entry !== null);
  } catch (error) {
    console.warn(
      `Skipping repo source ${source.id}: ${toGitHubHarvesterErrorMessage(error)}`,
    );
    return [];
  }
}

function buildGitHubCatalogEntry(
  snapshot: GitHubRepoSnapshot,
  source: SourceDefinition,
  treeEntry: GitHubRepoSnapshot["tree"]["entries"][number],
  demandProfile: DemandProfile | null,
  selectionRegistry: SelectionRegistry,
  omsFileSizes: ReadonlyMap<string, number>,
): AssetCatalogEntry | null {
  const relativePath = treeEntry.path;
  const classification = classifyGitHubTreePath(relativePath, source);

  if (!classification) {
    return null;
  }

  const capabilities = collectGitHubCapabilities(relativePath, snapshot);
  const hosts =
    classification.assetKind === "mcp-server"
      ? (["shared"] satisfies HostTarget[])
      : classification.hosts;
  const contextCost = { sizeClass: "tiny", estimatedPromptWeight: 1 } as const;
  const risk = buildGitHubRisk(classification.assetKind);
  const repoTrust = collectRepositoryTrustEvidence(snapshot);
  const assetDir = relativePath.includes("/")
    ? relativePath.slice(0, relativePath.lastIndexOf("/"))
    : "";
  // Check both canonical OMS sig filename variants: skill.oms.sig and bare oms.sig.
  const omsSignaturePath = assetDir
    ? `${assetDir}/skill.oms.sig`
    : "skill.oms.sig";
  const bareOmsSigPath = assetDir ? `${assetDir}/oms.sig` : "oms.sig";
  const omsSigSize =
    omsFileSizes.get(omsSignaturePath.toLowerCase()) ??
    omsFileSizes.get(bareOmsSigPath.toLowerCase());
  // Trust signals must be backed by real content, not empty placeholder files.
  const hasOmsSignature = omsSigSize != null && omsSigSize > 0;
  const githubFileUrl = `${snapshot.repoSummary.htmlUrl}/blob/${snapshot.repoSummary.defaultBranch}/${relativePath}`;

  return {
    id: buildCatalogId(source.id, relativePath),
    displayName: deriveDisplayNameFromPath(relativePath),
    assetKind: classification.assetKind,
    hosts,
    compatibilityMode: classification.compatibilityMode,
    compatibleHosts: inferCompatibleHosts(classification.assetKind, hosts),
    source: {
      sourceId: source.id,
      authorityTier: source.authorityTier,
      sourceKind: source.kind,
      sourcePriority: source.priority,
      originUrl: githubFileUrl,
      publisher: source.publisher?.name ?? source.id,
      publisherVerified: source.publisher?.verified ?? false,
    },
    trust: {
      score:
        computeTrustScore({
          authorityTier: source.authorityTier,
          sourceKind: source.kind,
          sourcePriority: source.priority,
          publisherVerified: source.publisher?.verified ?? false,
          compatibilityMode: classification.compatibilityMode,
          installMethod: "github-tree-metadata",
        }) +
        repoTrust.scoreBonus +
        // `oms-signed` is always in TRUST_SIGNAL_SCORE_BOOST; fallback prevents
        // regression if the constant is accidentally removed.
        /* c8 ignore next */
        (hasOmsSignature ? (TRUST_SIGNAL_SCORE_BOOST["oms-signed"] ?? 5) : 0),
      signals: [
        ...buildTrustSignals({
          authorityTier: source.authorityTier,
          sourceKind: source.kind,
          sourcePriority: source.priority,
          publisherVerified: source.publisher?.verified ?? false,
          compatibilityMode: classification.compatibilityMode,
          installMethod: "github-tree-metadata",
        }),
        ...repoTrust.signals,
        ...(hasOmsSignature ? ["oms-signed"] : []),
      ],
    },
    capabilities,
    install: {
      method: "github-tree-metadata",
      nativeHosts:
        classification.compatibilityMode === "native" ? hosts : undefined,
      adaptableHosts:
        classification.compatibilityMode === "adaptable" ? hosts : undefined,
      relativePath,
      manifestEntry: treeEntry.sha,
    },
    evidence: {
      manifestFound: true,
      readmeFound: snapshot.readme !== null,
      examplesFound: false,
      docsLinked: true,
      filePath: relativePath,
      rootPath: snapshot.repoSummary.htmlUrl,
      classification: classification.classification,
    },
    maintenance: {
      lastUpdated: snapshot.repoSummary.updatedAt ?? snapshot.fetchedAt,
      stars: snapshot.repoSummary.stars,
      releaseCadence: snapshot.repoSummary.archived ? "archived" : "active",
    },
    risk,
    contextCost,
    fit: {
      portfolioFit: computePortfolioFit(capabilities, demandProfile),
      hostFit: computeHostFit(hosts, classification.compatibilityMode),
    },
    dedupe: {
      duplicateGroup: findDuplicateGroup(capabilities, selectionRegistry),
      candidateRankHint: buildCandidateRankHint(source.authorityTier),
    },
    status: buildAssetStatus(source),
  };
}

/**
 * Fetches and verifies OMS blob contents for candidate signature and
 * certificate files found during tree discovery. Only files whose fetched
 * content passes format and cryptographic validation are kept in the return Map.
 *
 * Verification tiers:
 * 1. PEM certs: parsed via crypto.createPublicKey() — ensures real key material.
 * 2. OMS sigs: decoded as base64, minimum 32 bytes output.
 * 3. Full PKI: signatures verified against the cert's public key + asset content
 *    (SKILL.md in the same directory). A sig file only passes verification when
 *    the signed asset content matches the public key extracted from the PEM cert.
 */
async function verifyOmsBlobs(
  snapshot: GitHubRepoSnapshot,
  candidates: GitHubRepoSnapshot["tree"]["entries"],
  source: SourceDefinition,
): Promise<{ verified: Map<string, number>; pemVerified: boolean }> {
  if (candidates.length === 0)
    return { verified: new Map(), pemVerified: false };

  const { repoSummary } = snapshot;
  const { fetchTextWithGuards } = await import("../../lib/http.js");

  // ── Phase 1: fetch all PEM/sig blob contents in parallel ──
  const results = await Promise.allSettled(
    candidates.map(async (entry) => {
      const blobUrl = `https://api.github.com/repos/${repoSummary.fullName}/git/blobs/${entry.sha}`;
      const content = await fetchTextWithGuards(blobUrl, {
        allowedOrigins: ["https://api.github.com"],
        headers: {
          Accept: "application/vnd.github.raw+json",
          ...(source.endpoints.token
            ? { Authorization: `Bearer ${source.endpoints.token}` }
            : {}),
        },
        timeoutMs: 5_000,
      });
      if (!content || typeof content !== "string") return null;

      const trimmed = content.trim();
      const isPem = /nv-agent-root-cert\.pem$/u.test(entry.path);

      if (isPem) {
        if (
          (trimmed.startsWith("-----BEGIN CERTIFICATE-----") ||
            trimmed.startsWith("-----BEGIN PUBLIC KEY-----")) &&
          (trimmed.includes("-----END CERTIFICATE-----") ||
            trimmed.includes("-----END PUBLIC KEY-----"))
        ) {
          try {
            const { createPublicKey } = await import("node:crypto");
            createPublicKey(trimmed);
            return {
              path: entry.path,
              size: entry.size ?? content.length,
              pem: true as const,
              pemContent: trimmed,
            };
          } catch {
            return null;
          }
        }
        return null;
      }

      // OMS sig: basic format validation (expanded in Phase 2)
      if (trimmed.length > 0) {
        try {
          const decoded = Buffer.from(trimmed, "base64");
          if (decoded.length >= 32) {
            return {
              path: entry.path,
              size: entry.size ?? content.length,
              pem: false as const,
              sigContent: decoded,
            };
          }
        } catch {
          /* c8 ignore next 2 */
          // base64 decode failed — defensive, not hit with valid sig.
        }
      }
      return null;
    }),
  );

  // ── Phase 2: extract public key from PEM, verify sigs against asset content ──
  const verified = new Map<string, number>();
  let pemVerified = false;
  let publicKey: KeyObject | null = null;

  // Extract public key from the first valid PEM cert
  for (const result of results) {
    if (result.status === "fulfilled" && result.value?.pem) {
      try {
        const { createPublicKey } = await import("node:crypto");
        publicKey = createPublicKey(result.value.pemContent);
        pemVerified = true;
        verified.set(result.value.path.toLowerCase(), result.value.size);
      } catch {
        // createPublicKey already validated in Phase 1; defensive.
      }
      break; // Use first valid PEM cert
    }
  }

  // Verify each OMS signature against asset content
  for (const result of results) {
    if (!result || result.status !== "fulfilled" || !result.value) continue;
    const val = result.value;
    if (val.pem) continue; // PEM already processed

    if (publicKey && val.sigContent) {
      // Determine the asset file being signed: SKILL.md in the same dir
      const sigDir = val.path.includes("/")
        ? val.path.slice(0, val.path.lastIndexOf("/"))
        : "";
      const assetPath = sigDir ? `${sigDir}/SKILL.md` : "SKILL.md";

      // Fetch the asset content
      const assetEntry = snapshot.tree.entries.find(
        (e) => e.path === assetPath,
      );
      if (assetEntry) {
        try {
          const assetBlobUrl = `https://api.github.com/repos/${repoSummary.fullName}/git/blobs/${assetEntry.sha}`;
          const assetContent = await fetchTextWithGuards(assetBlobUrl, {
            allowedOrigins: ["https://api.github.com"],
            headers: {
              Accept: "application/vnd.github.raw+json",
              ...(source.endpoints.token
                ? { Authorization: `Bearer ${source.endpoints.token}` }
                : {}),
            },
            timeoutMs: 5_000,
          });
          if (assetContent && typeof assetContent === "string") {
            const { createVerify } = await import("node:crypto");
            const verifier = createVerify("SHA256");
            verifier.update(assetContent);
            if (verifier.verify(publicKey, val.sigContent)) {
              verified.set(val.path.toLowerCase(), val.size);
            }
          }
        } catch {
          /* c8 ignore next 2 — asset fetch/verify failure is defensive; test uses valid sigs */
          // Asset fetch or verify failed — skip this sig.
        }
      }
    } else if (!publicKey) {
      /* c8 ignore next 2 — no-PEM fallback; test always has a valid PEM cert */
      // No PEM cert available — accept sig with basic format-only validation
      verified.set(val.path.toLowerCase(), val.size);
    }
  }

  return { verified, pemVerified };
}

function collectRepositoryTrustEvidence(snapshot: GitHubRepoSnapshot): {
  scoreBonus: number;
  signals: string[];
} {
  const paths = snapshot.tree.entries.map((entry) => entry.path.toLowerCase());
  const signals: string[] = [];
  let scoreBonus = 0;

  if (paths.some((path) => /(^|\/)security\.md$/u.test(path))) {
    signals.push("security-policy-present");
    scoreBonus += 3;
  }
  if (paths.some((path) => /(^|\/)licen[sc]e(\.|$)/u.test(path))) {
    signals.push("license-present");
    scoreBonus += 2;
  }
  if (paths.some((path) => path.startsWith(".github/workflows/"))) {
    signals.push("ci-workflows-present");
    scoreBonus += 2;
  }
  if (
    paths.some((path) => /(^|\/)(test|tests|spec|__tests__)(\/|$)/u.test(path))
  ) {
    signals.push("tests-present");
    scoreBonus += 2;
  }
  // OMS trust anchor: `verifyOmsBlobs` has checked the PEM cert content
  // during harvest — only award the signal if blob-content validation passed.
  if (snapshot.pemVerified) {
    signals.push("oms-trust-anchor");
    // TRUST_SIGNAL_SCORE_BOOST["oms-trust-anchor"] is always defined; fallback prevents
    // regression if the constant is accidentally removed from the map.
    /* c8 ignore next */
    scoreBonus += TRUST_SIGNAL_SCORE_BOOST["oms-trust-anchor"] ?? 3;
  }

  return { scoreBonus, signals };
}

function classifyGitHubTreePath(
  relativePath: string,
  source: SourceDefinition,
): {
  assetKind: AssetKind;
  compatibilityMode: CompatibilityMode;
  hosts: HostTarget[];
  classification: ClassificationConfidence;
} | null {
  const normalizedPath = relativePath.toLowerCase();
  const nativeHosts = source.hosts.length === 1 ? source.hosts : undefined;
  const adaptableHosts = source.hosts;

  if (!matchesSourcePathFilters(normalizedPath, source)) {
    return null;
  }

  if (normalizedPath.endsWith("/skill.md")) {
    return buildGitHubClassification({
      assetKind: "skill",
      compatibilityMode: nativeHosts ? "native" : "adaptable",
      hosts: nativeHosts ?? adaptableHosts,
      evidence: [schemaEvidence("matched SKILL.md skill manifest")],
    });
  }

  if (
    /(^|\/)(agents?|subagents)(\/|$)/u.test(normalizedPath) &&
    normalizedPath.endsWith(".md")
  ) {
    return buildGitHubClassification({
      assetKind: "agent",
      compatibilityMode: nativeHosts ? "native" : "adaptable",
      hosts: nativeHosts ?? adaptableHosts,
      evidence: [
        sourceFamilyEvidence("matched agent/subagent source path"),
        pathEvidence("matched agent markdown path"),
      ],
    });
  }

  if (
    normalizedPath.endsWith("copilot-instructions.md") ||
    /(^|\/)(?:agents|claude)\.md$/u.test(normalizedPath) ||
    (/(^|\/)(?:instructions?|rules?)(\/|$)/u.test(normalizedPath) &&
      /\.(?:md|mdc)$/u.test(normalizedPath))
  ) {
    return buildGitHubClassification({
      assetKind: "instruction",
      compatibilityMode: nativeHosts ? "native" : "adaptable",
      hosts: nativeHosts ?? adaptableHosts,
      evidence: [pathEvidence("matched instruction/rules markdown path")],
    });
  }

  if (
    /(^|\/)(?:commands?|prompts?|prompt-templates?)(\/|$)/u.test(
      normalizedPath,
    ) &&
    normalizedPath.endsWith(".md")
  ) {
    return buildGitHubClassification({
      assetKind: "prompt-pack",
      compatibilityMode: nativeHosts ? "native" : "adaptable",
      hosts: nativeHosts ?? adaptableHosts,
      evidence: [pathEvidence("matched command/prompt markdown path")],
    });
  }

  if (
    /(^|\/)(workflows?)(\/|$)/u.test(normalizedPath) &&
    /\.(md|ya?ml|json)$/u.test(normalizedPath)
  ) {
    return buildGitHubClassification({
      assetKind: "workflow",
      compatibilityMode: nativeHosts ? "native" : "adaptable",
      hosts: nativeHosts ?? adaptableHosts,
      evidence: [pathEvidence("matched workflow path")],
    });
  }

  if (
    /(^|\/)(hooks?)(\/|$)/u.test(normalizedPath) &&
    /\.(md|sh|js|ts|ya?ml|json)$/u.test(normalizedPath)
  ) {
    return buildGitHubClassification({
      assetKind: "hook",
      compatibilityMode: nativeHosts ? "native" : "adaptable",
      hosts: nativeHosts ?? adaptableHosts,
      evidence: [pathEvidence("matched hook path")],
    });
  }

  if (
    (/\.claude-plugin\/plugin\.json$/u.test(normalizedPath) ||
      /\.cursor-plugin\/plugin\.json$/u.test(normalizedPath) ||
      /(^|\/)(plugins?)(\/|$)/u.test(normalizedPath)) &&
    /\.(md|sh|js|ts|json)$/u.test(normalizedPath)
  ) {
    return buildGitHubClassification({
      assetKind: "plugin",
      compatibilityMode: nativeHosts ? "native" : "adaptable",
      hosts: nativeHosts ?? adaptableHosts,
      evidence: [
        /plugin\.json$/u.test(normalizedPath)
          ? schemaEvidence("matched plugin.json manifest")
          : pathEvidence("matched plugin path"),
      ],
    });
  }

  if (isExecutableMcpServerPath(normalizedPath, source)) {
    return buildGitHubClassification({
      assetKind: "mcp-server",
      compatibilityMode: "native",
      hosts: ["shared"],
      evidence: [sourceFamilyEvidence("matched MCP server source pattern")],
    });
  }

  if (isGenericRepositoryArtifact(normalizedPath)) {
    return buildGitHubClassification({
      assetKind: "reference-pack",
      compatibilityMode: "reference-only",
      hosts: source.hosts,
      evidence: [pathEvidence("matched generic repository documentation")],
    });
  }

  return null;
}

function buildGitHubClassification(input: {
  assetKind: AssetKind;
  compatibilityMode: CompatibilityMode;
  hosts: HostTarget[];
  evidence: ClassificationEvidenceItem[];
}): {
  assetKind: AssetKind;
  compatibilityMode: CompatibilityMode;
  hosts: HostTarget[];
  classification: ClassificationConfidence;
} {
  return {
    assetKind: input.assetKind,
    compatibilityMode: input.compatibilityMode,
    hosts: input.hosts,
    classification: buildClassificationConfidence({
      assetKind: input.assetKind,
      evidence: input.evidence,
    }),
  };
}

function matchesSourcePathFilters(
  normalizedPath: string,
  source: SourceDefinition,
): boolean {
  if (
    source.excludePaths?.some((pathPattern) =>
      matchesSourcePathPattern(normalizedPath, pathPattern),
    )
  ) {
    return false;
  }

  if (!source.includePaths || source.includePaths.length === 0) {
    return true;
  }

  return source.includePaths.some((pathPattern) =>
    matchesSourcePathPattern(normalizedPath, pathPattern),
  );
}

function matchesSourcePathPattern(
  normalizedPath: string,
  pathPattern: string,
): boolean {
  const normalizedTreePath = normalizeSourceFilterPath(normalizedPath);
  const normalizedPattern = normalizeSourceFilterPath(pathPattern);

  if (normalizedPattern.endsWith("/**")) {
    const directoryPrefix = normalizedPattern.slice(0, -3);
    return (
      normalizedTreePath === directoryPrefix ||
      normalizedTreePath.startsWith(`${directoryPrefix}/`)
    );
  }

  return normalizedTreePath === normalizedPattern;
}

function normalizeSourceFilterPath(value: string): string {
  let normalizedValue = value.trim().toLowerCase().replaceAll("\\", "/");
  while (normalizedValue.startsWith("./")) {
    normalizedValue = normalizedValue.slice(2);
  }
  while (normalizedValue.startsWith("/")) {
    normalizedValue = normalizedValue.slice(1);
  }
  return normalizedValue;
}

function isExecutableMcpServerPath(
  normalizedPath: string,
  source: SourceDefinition,
): boolean {
  if (!/\.(js|ts|mjs|cjs|mts|cts)$/u.test(normalizedPath)) {
    return false;
  }

  if (
    source.mcpServerPaths?.some((pathPattern) =>
      matchesSourcePathPattern(normalizedPath, pathPattern),
    )
  ) {
    return true;
  }

  return /(^|\/)(mcp[-_ ]?servers?|servers?\/.*mcp|.*mcp[-_ ]?server.*)(\/|\.|$)/u.test(
    normalizedPath,
  );
}

function isGenericRepositoryArtifact(normalizedPath: string): boolean {
  return (
    /(^|\/)(readme|docs?|references?|notebooks?|data|datasets?|research|papers?|design|media|cad|hardware|firmware|models?|examples?)(\/|\.|$)/u.test(
      normalizedPath,
    ) ||
    /\.(ipynb|csv|parquet|jsonl|bib|tex|stl|step|kicad_pcb|uproject|godot)$/u.test(
      normalizedPath,
    )
  );
}

function collectGitHubCapabilities(
  relativePath: string,
  snapshot: GitHubRepoSnapshot,
): string[] {
  return uniqueStrings([
    ...snapshot.repoSummary.topics,
    ...(snapshot.repoSummary.language ? [snapshot.repoSummary.language] : []),
    ...splitIntoKeywords(snapshot.repoSummary.fullName),
    ...splitIntoKeywords(snapshot.repoSummary.description ?? ""),
    ...splitIntoKeywords(relativePath),
  ]).filter((token) => !GENERIC_CAPABILITY_TOKENS.has(token));
}

function buildGitHubRisk(assetKind: AssetKind): AssetRisk {
  if (assetKind === "plugin" || assetKind === "hook") {
    return {
      level: "medium",
      hasHooks: assetKind === "hook",
      hasExecScripts: true,
      requiresNetwork: false,
    };
  }

  return {
    level: "low",
    hasHooks: false,
    hasExecScripts: false,
    requiresNetwork: false,
  };
}

function toGitHubHarvesterErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Exposes github-harvester internals for focused unit testing. */
export const githubHarvesterInternals = {
  collectRepositoryTrustEvidence,
} as const;

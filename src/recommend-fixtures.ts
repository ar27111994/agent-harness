import type {
  AssetCatalogEntry,
  AssetKind,
  AuthorityTier,
  CompatibilityMode,
  DemandProfile,
  HostTarget,
  RecommendationEvaluationFixture,
  SourceKind,
} from "./types.js";

const FIXTURE_UPDATED_AT = new Date(
  Date.now() - 3 * 24 * 60 * 60 * 1000,
).toISOString();
const FIXTURE_GENERATED_AT = new Date(
  Date.now() - 4 * 24 * 60 * 60 * 1000,
).toISOString();

interface FixtureAssetOptions {
  assetKind: AssetKind;
  hosts: HostTarget[];
  capabilities: string[];
  sourceId: string;
  publisher: string;
  authorityTier?: AuthorityTier;
  compatibilityMode?: CompatibilityMode;
  estimatedPromptWeight?: number;
  portfolioFit?: number;
  hostFit?: number;
  sourceKind?: SourceKind;
  sourcePriority?: number;
  trustScore?: number;
}

/**
 * Builds recommendation fixtures from the provided inputs.
 */
export function buildRecommendationFixtures(): RecommendationEvaluationFixture[] {
  return [
    buildBackendIntegrationFixture(),
    buildFrontendQualityFixture(),
    buildInfraSecurityFixture(),
    buildLocalAvailabilitySeparationFixture(),
    buildSharedExecutableBiasFixture(),
    buildSharedSourceSaturationFixture(),
  ];
}

function buildBackendIntegrationFixture(): RecommendationEvaluationFixture {
  return {
    schemaVersion: 1,
    id: "backend-integration",
    description:
      "Backend-heavy workspace should surface webhook, testing, infra, and shared integration assets without over-concentrating one publisher.",
    demandProfile: createDemandProfile({
      frameworks: ["express", "node-backend", "apify"],
      concerns: ["backend", "integration", "testing", "webhook", "automation"],
      tooling: ["node", "typescript", "docker", "webhook", "jest"],
    }),
    catalogEntries: [
      createAsset("official-backend-instruction", {
        assetKind: "instruction",
        hosts: ["copilot-vscode", "opencode"],
        capabilities: ["backend", "node", "express", "typescript"],
        sourceId: "microsoft-backend-guidance",
        publisher: "microsoft",
        authorityTier: "official-first-party",
      }),
      createAsset("official-webhook-workflow", {
        assetKind: "workflow",
        hosts: ["copilot-vscode", "opencode"],
        capabilities: ["workflow", "webhook", "integration", "automation"],
        sourceId: "microsoft-backend-guidance",
        publisher: "microsoft",
        authorityTier: "official-first-party",
      }),
      createAsset("community-backend-skill", {
        assetKind: "skill",
        hosts: ["copilot-vscode", "opencode"],
        capabilities: ["backend", "service", "api", "testing"],
        sourceId: "community-backend-lab",
        publisher: "community-backend-lab",
      }),
      createAsset("community-testing-skill", {
        assetKind: "skill",
        hosts: ["copilot-vscode", "opencode"],
        capabilities: ["testing", "jest", "debugging", "qa"],
        sourceId: "qa-lab",
        publisher: "qa-lab",
      }),
      createAsset("infra-docker-plugin", {
        assetKind: "plugin",
        hosts: ["copilot-vscode", "opencode"],
        capabilities: ["docker", "container", "devops", "infrastructure"],
        sourceId: "devops-inc",
        publisher: "devops-inc",
      }),
      createAsset("shared-webhook-mcp", {
        assetKind: "mcp-server",
        hosts: ["shared"],
        capabilities: ["mcp", "webhook", "integration", "backend"],
        sourceId: "shared-integrations",
        publisher: "shared-integrations",
        authorityTier: "official-compatible",
      }),
      createAsset("generic-writing-skill", {
        assetKind: "skill",
        hosts: ["copilot-vscode", "opencode"],
        capabilities: ["article", "writing", "brand", "voice"],
        sourceId: "content-suite",
        publisher: "content-suite",
        portfolioFit: 0.2,
        hostFit: 0.3,
      }),
      createAsset("same-family-backend-agent", {
        assetKind: "agent",
        hosts: ["copilot-vscode", "opencode"],
        capabilities: ["backend", "integration", "webhook"],
        sourceId: "community-backend-lab",
        publisher: "community-backend-lab",
      }),
    ],
    expectations: [
      {
        host: "copilot-vscode",
        requiredAssetIds: [
          "official-backend-instruction",
          "official-webhook-workflow",
          "infra-docker-plugin",
        ],
        requiredAssetKinds: [
          { assetKind: "instruction", minimum: 1 },
          { assetKind: "workflow", minimum: 1 },
          { assetKind: "skill", minimum: 2 },
        ],
        maxPerSourceFamily: 2,
        requiredConcerns: ["backend", "integration", "testing"],
      },
      {
        host: "opencode",
        requiredAssetIds: ["community-backend-skill", "infra-docker-plugin"],
        requiredAssetKinds: [
          { assetKind: "skill", minimum: 2 },
          { assetKind: "workflow", minimum: 1 },
        ],
        maxPerSourceFamily: 2,
        requiredConcerns: ["backend", "testing"],
      },
      {
        host: "shared",
        requiredAssetIds: ["shared-webhook-mcp"],
        requiredAssetKinds: [{ assetKind: "mcp-server", minimum: 1 }],
        maxPerSourceFamily: 2,
        requiredConcerns: ["integration"],
      },
    ],
  };
}

function buildFrontendQualityFixture(): RecommendationEvaluationFixture {
  return {
    schemaVersion: 1,
    id: "frontend-quality",
    description:
      "Frontend workspace should favor UI, accessibility, testing, and documentation instead of backend-only assets.",
    demandProfile: createDemandProfile({
      frameworks: ["react", "frontend"],
      concerns: ["frontend", "testing", "docs"],
      tooling: ["typescript", "playwright", "node"],
    }),
    catalogEntries: [
      createAsset("frontend-ui-instruction", {
        assetKind: "instruction",
        hosts: ["copilot-vscode", "opencode"],
        capabilities: ["frontend", "react", "ui", "accessibility"],
        sourceId: "ui-foundation",
        publisher: "ui-foundation",
        authorityTier: "official-first-party",
      }),
      createAsset("frontend-testing-skill", {
        assetKind: "skill",
        hosts: ["copilot-vscode", "opencode"],
        capabilities: ["playwright", "testing", "qa", "frontend"],
        sourceId: "qa-lab",
        publisher: "qa-lab",
      }),
      createAsset("frontend-docs-agent", {
        assetKind: "agent",
        hosts: ["copilot-vscode", "opencode"],
        capabilities: ["docs", "guide", "frontend", "react"],
        sourceId: "ui-foundation",
        publisher: "ui-foundation",
        authorityTier: "official-compatible",
      }),
      createAsset("backend-only-agent", {
        assetKind: "agent",
        hosts: ["copilot-vscode", "opencode"],
        capabilities: ["backend", "api", "service", "webhook"],
        sourceId: "backend-co",
        publisher: "backend-co",
      }),
      createAsset("shared-ui-mcp", {
        assetKind: "mcp-server",
        hosts: ["shared"],
        capabilities: ["mcp", "frontend", "accessibility", "testing"],
        sourceId: "shared-ui-suite",
        publisher: "shared-ui-suite",
      }),
      createAsset("content-marketing-skill", {
        assetKind: "skill",
        hosts: ["copilot-vscode", "opencode"],
        capabilities: ["brand", "article", "writing", "marketing"],
        sourceId: "content-suite",
        publisher: "content-suite",
        portfolioFit: 0.15,
        hostFit: 0.2,
      }),
    ],
    expectations: [
      {
        host: "copilot-vscode",
        requiredAssetIds: [
          "frontend-ui-instruction",
          "frontend-testing-skill",
          "frontend-docs-agent",
        ],
        requiredAssetKinds: [
          { assetKind: "instruction", minimum: 1 },
          { assetKind: "skill", minimum: 1 },
          { assetKind: "agent", minimum: 1 },
        ],
        maxPerSourceFamily: 2,
        requiredConcerns: ["frontend", "testing", "docs"],
      },
      {
        host: "shared",
        requiredAssetIds: ["shared-ui-mcp"],
        requiredAssetKinds: [{ assetKind: "mcp-server", minimum: 1 }],
        requiredConcerns: ["frontend"],
      },
    ],
  };
}

function buildInfraSecurityFixture(): RecommendationEvaluationFixture {
  return {
    schemaVersion: 1,
    id: "infra-security",
    description:
      "Infra and security workspace should reward governance, infra, and data/security tooling with balanced source families.",
    demandProfile: createDemandProfile({
      frameworks: ["terraform", "docker"],
      concerns: ["security", "infrastructure", "data", "integration"],
      tooling: ["terraform", "docker", "postgres", "mcp"],
    }),
    catalogEntries: [
      createAsset("terraform-security-instruction", {
        assetKind: "instruction",
        hosts: ["copilot-vscode", "opencode"],
        capabilities: ["terraform", "security", "infra", "governance"],
        sourceId: "azure-secure-iac",
        publisher: "microsoft",
        authorityTier: "official-first-party",
      }),
      createAsset("docker-ops-plugin", {
        assetKind: "plugin",
        hosts: ["copilot-vscode", "opencode"],
        capabilities: ["docker", "container", "devops", "infra"],
        sourceId: "ops-foundry",
        publisher: "ops-foundry",
      }),
      createAsset("policy-audit-agent", {
        assetKind: "agent",
        hosts: ["copilot-vscode", "opencode"],
        capabilities: ["security", "audit", "governance", "compliance"],
        sourceId: "security-lab",
        publisher: "security-lab",
      }),
      createAsset("shared-postgres-mcp", {
        assetKind: "mcp-server",
        hosts: ["shared"],
        capabilities: ["mcp", "postgres", "database", "security"],
        sourceId: "shared-data-tools",
        publisher: "shared-data-tools",
        authorityTier: "official-compatible",
      }),
      createAsset("shared-kubernetes-mcp", {
        assetKind: "mcp-server",
        hosts: ["shared"],
        capabilities: ["mcp", "kubernetes", "infra", "integration"],
        sourceId: "shared-ops-tools",
        publisher: "shared-ops-tools",
        authorityTier: "official-compatible",
      }),
      createAsset("same-family-second-security-agent", {
        assetKind: "agent",
        hosts: ["copilot-vscode", "opencode"],
        capabilities: ["security", "threat", "audit", "integration"],
        sourceId: "security-lab",
        publisher: "security-lab",
      }),
    ],
    expectations: [
      {
        host: "copilot-vscode",
        requiredAssetIds: [
          "terraform-security-instruction",
          "docker-ops-plugin",
          "policy-audit-agent",
        ],
        requiredAssetKinds: [
          { assetKind: "instruction", minimum: 1 },
          { assetKind: "plugin", minimum: 1 },
          { assetKind: "agent", minimum: 1 },
        ],
        maxPerSourceFamily: 2,
        requiredConcerns: ["security", "infra"],
      },
      {
        host: "shared",
        requiredAssetIds: ["shared-postgres-mcp", "shared-kubernetes-mcp"],
        requiredAssetKinds: [{ assetKind: "mcp-server", minimum: 2 }],
        maxPerSourceFamily: 2,
        requiredConcerns: ["security", "integration", "data"],
      },
    ],
  };
}

function buildLocalAvailabilitySeparationFixture(): RecommendationEvaluationFixture {
  return {
    schemaVersion: 1,
    id: "local-availability-separation",
    description:
      "Local assets should stay visible for convenience without outranking stronger workspace-fit recommendations.",
    demandProfile: createDemandProfile({
      frameworks: ["react"],
      concerns: ["frontend", "testing"],
      tooling: ["typescript", "playwright", "node"],
    }),
    catalogEntries: [
      createAsset("official-react-guidance", {
        assetKind: "instruction",
        hosts: ["copilot-vscode"],
        capabilities: ["react", "frontend", "typescript", "testing"],
        sourceId: "ui-foundation",
        publisher: "ui-foundation",
        authorityTier: "official-first-party",
      }),
      createAsset("local-generic-toolkit", {
        assetKind: "skill",
        hosts: ["copilot-vscode"],
        capabilities: ["automation", "workflow", "assistant", "docs"],
        sourceId: "local-cursor-config",
        publisher: "local",
        authorityTier: "trusted-local",
        sourceKind: "local-directory",
        sourcePriority: 100,
      }),
      createAsset("local-react-snippets", {
        assetKind: "skill",
        hosts: ["copilot-vscode"],
        capabilities: ["react", "frontend", "typescript", "component"],
        sourceId: "local-cursor-config",
        publisher: "local",
        authorityTier: "trusted-local",
        sourceKind: "local-directory",
        sourcePriority: 100,
      }),
      createAsset("community-react-testing", {
        assetKind: "skill",
        hosts: ["copilot-vscode"],
        capabilities: ["react", "frontend", "playwright", "testing"],
        sourceId: "qa-lab",
        publisher: "qa-lab",
      }),
    ],
    expectations: [
      {
        host: "copilot-vscode",
        requiredAssetIds: [
          "official-react-guidance",
          "local-react-snippets",
          "community-react-testing",
        ],
        requiredAssetKinds: [
          { assetKind: "instruction", minimum: 1 },
          { assetKind: "skill", minimum: 2 },
        ],
        requiredConcerns: ["frontend", "testing"],
        rankedAbove: [
          {
            higherAssetId: "official-react-guidance",
            lowerAssetId: "local-generic-toolkit",
          },
          {
            higherAssetId: "community-react-testing",
            lowerAssetId: "local-generic-toolkit",
          },
          {
            higherAssetId: "local-react-snippets",
            lowerAssetId: "local-generic-toolkit",
          },
        ],
      },
    ],
  };
}

function buildSharedExecutableBiasFixture(): RecommendationEvaluationFixture {
  return {
    schemaVersion: 1,
    id: "shared-executable-bias",
    description:
      "Shared recommendations should rank executable MCP servers above wrapper-like MCP config or reference assets.",
    demandProfile: createDemandProfile({
      frameworks: ["apify"],
      concerns: ["integration", "backend", "automation"],
      tooling: ["mcp", "webhook", "node"],
    }),
    catalogEntries: [
      createAsset("shared-executable-webhook-mcp", {
        assetKind: "mcp-server",
        hosts: ["shared"],
        capabilities: ["mcp", "webhook", "integration", "backend"],
        sourceId: "shared-integrations",
        publisher: "shared-integrations",
        authorityTier: "official-compatible",
      }),
      createAsset("shared-reference-wrapper-mcp-json", {
        assetKind: "mcp-server",
        hosts: ["shared"],
        capabilities: ["mcp", "reference", "config", "integration"],
        sourceId: "shared-reference-docs",
        publisher: "shared-reference-docs",
        authorityTier: "official-compatible",
      }),
      createAsset("shared-scenarios-wrapper-mcp-yaml", {
        assetKind: "mcp-server",
        hosts: ["shared"],
        capabilities: ["mcp", "scenario", "integration", "automation"],
        sourceId: "shared-scenario-docs",
        publisher: "shared-scenario-docs",
        authorityTier: "official-compatible",
      }),
      createAsset("shared-postgres-mcp", {
        assetKind: "mcp-server",
        hosts: ["shared"],
        capabilities: ["mcp", "postgres", "database", "integration"],
        sourceId: "shared-data-tools",
        publisher: "shared-data-tools",
        authorityTier: "official-compatible",
      }),
    ],
    expectations: [
      {
        host: "shared",
        requiredAssetIds: ["shared-executable-webhook-mcp"],
        requiredAssetKinds: [{ assetKind: "mcp-server", minimum: 4 }],
        requiredConcerns: ["integration", "backend"],
        rankedAbove: [
          {
            higherAssetId: "shared-executable-webhook-mcp",
            lowerAssetId: "shared-reference-wrapper-mcp-json",
          },
          {
            higherAssetId: "shared-postgres-mcp",
            lowerAssetId: "shared-reference-wrapper-mcp-json",
          },
          {
            higherAssetId: "shared-executable-webhook-mcp",
            lowerAssetId: "shared-scenarios-wrapper-mcp-yaml",
          },
          {
            higherAssetId: "shared-postgres-mcp",
            lowerAssetId: "shared-scenarios-wrapper-mcp-yaml",
          },
        ],
      },
    ],
  };
}

function buildSharedSourceSaturationFixture(): RecommendationEvaluationFixture {
  return {
    schemaVersion: 1,
    id: "shared-source-saturation",
    description:
      "Shared recommendations should not let the third and fourth entries from one publisher outrank executable servers from other publishers.",
    demandProfile: createDemandProfile({
      frameworks: ["node-backend"],
      concerns: ["integration", "backend"],
      tooling: ["mcp", "node", "typescript"],
    }),
    catalogEntries: [
      createAsset("shared-family-a-server-1", {
        assetKind: "mcp-server",
        hosts: ["shared"],
        capabilities: ["mcp", "backend", "integration", "node-backend"],
        sourceId: "family-a-tools",
        publisher: "family-a-tools",
        authorityTier: "official-compatible",
      }),
      createAsset("shared-family-a-server-2", {
        assetKind: "mcp-server",
        hosts: ["shared"],
        capabilities: ["mcp", "backend", "integration", "node-backend"],
        sourceId: "family-a-tools",
        publisher: "family-a-tools",
        authorityTier: "official-compatible",
      }),
      createAsset("shared-family-a-server-3", {
        assetKind: "mcp-server",
        hosts: ["shared"],
        capabilities: ["mcp", "backend", "integration", "node-backend"],
        sourceId: "family-a-tools",
        publisher: "family-a-tools",
        authorityTier: "official-compatible",
      }),
      createAsset("shared-family-a-server-4", {
        assetKind: "mcp-server",
        hosts: ["shared"],
        capabilities: ["mcp", "backend", "integration", "node-backend"],
        sourceId: "family-a-tools",
        publisher: "family-a-tools",
        authorityTier: "official-compatible",
      }),
      createAsset("shared-family-b-server", {
        assetKind: "mcp-server",
        hosts: ["shared"],
        capabilities: ["mcp", "backend", "integration", "node-backend"],
        sourceId: "family-b-tools",
        publisher: "family-b-tools",
        authorityTier: "official-compatible",
      }),
      createAsset("shared-family-c-server", {
        assetKind: "mcp-server",
        hosts: ["shared"],
        capabilities: ["mcp", "backend", "integration", "node-backend"],
        sourceId: "family-c-tools",
        publisher: "family-c-tools",
        authorityTier: "official-compatible",
      }),
    ],
    expectations: [
      {
        host: "shared",
        requiredAssetIds: [
          "shared-family-a-server-1",
          "shared-family-b-server",
          "shared-family-c-server",
        ],
        requiredAssetKinds: [{ assetKind: "mcp-server", minimum: 6 }],
        requiredConcerns: ["integration", "backend"],
        rankedAbove: [
          {
            higherAssetId: "shared-family-b-server",
            lowerAssetId: "shared-family-a-server-3",
          },
          {
            higherAssetId: "shared-family-c-server",
            lowerAssetId: "shared-family-a-server-4",
          },
        ],
      },
    ],
  };
}

function createDemandProfile(
  overrides: Partial<DemandProfile["signals"]>,
): DemandProfile {
  return {
    schemaVersion: 1,
    generatedAt: FIXTURE_GENERATED_AT,
    scanRoot: "fixtures/workspace",
    summary: {
      scannedFiles: 8,
      matchedFiles: 4,
    },
    signals: {
      languages: ["typescript"],
      packageManagers: ["npm"],
      frameworks: overrides.frameworks ?? [],
      concerns: overrides.concerns ?? [],
      tooling: overrides.tooling ?? [],
    },
    evidence: [
      {
        path: "package.json",
        fileName: "package.json",
        matchedSignals: {
          languages: ["typescript"],
          packageManagers: ["npm"],
          frameworks: overrides.frameworks ?? [],
          concerns: overrides.concerns ?? [],
          tooling: overrides.tooling ?? [],
        },
      },
      {
        path: "README.md",
        fileName: "README.md",
        matchedSignals: {
          languages: [],
          packageManagers: [],
          frameworks: overrides.frameworks?.slice(0, 1) ?? [],
          concerns: overrides.concerns?.slice(0, 3) ?? [],
          tooling: overrides.tooling?.slice(0, 2) ?? [],
        },
      },
    ],
  };
}

function isFixturePublisherVerified(authorityTier: AuthorityTier): boolean {
  return (
    authorityTier !== "trusted-community" &&
    authorityTier !== "unverified-community"
  );
}

function createAsset(
  id: string,
  options: FixtureAssetOptions,
): AssetCatalogEntry {
  return {
    id,
    displayName: id,
    assetKind: options.assetKind,
    hosts: options.hosts,
    compatibilityMode: options.compatibilityMode ?? "native",
    source: {
      sourceId: options.sourceId,
      authorityTier: options.authorityTier ?? "trusted-community",
      sourceKind: options.sourceKind ?? "repo",
      sourcePriority: options.sourcePriority ?? 80,
      originUrl: `https://example.com/${options.sourceId}/${id}`,
      publisher: options.publisher,
      publisherVerified: isFixturePublisherVerified(
        options.authorityTier ?? "trusted-community",
      ),
    },
    trust: {
      score: options.trustScore ?? 82,
      signals: [`authority:${options.authorityTier ?? "trusted-community"}`],
    },
    capabilities: options.capabilities,
    install: {
      method: "fixture",
      nativeHosts: options.hosts,
    },
    evidence: {
      manifestFound: true,
      readmeFound: true,
      examplesFound: false,
      docsLinked: true,
      filePath: `${id}.md`,
      rootPath: `https://example.com/${options.sourceId}`,
    },
    maintenance: {
      lastUpdated: FIXTURE_UPDATED_AT,
      stars: 1000,
      releaseCadence: "active",
    },
    risk: {
      level: "low",
      hasHooks: false,
      hasExecScripts: false,
      requiresNetwork: false,
    },
    contextCost: {
      sizeClass:
        options.estimatedPromptWeight && options.estimatedPromptWeight > 3
          ? "medium"
          : "small",
      estimatedPromptWeight: options.estimatedPromptWeight ?? 2,
    },
    fit: {
      portfolioFit: options.portfolioFit ?? 0.92,
      hostFit: options.hostFit ?? 0.88,
    },
    dedupe: {
      candidateRankHint: "fixture",
    },
    status: {
      cataloged: true,
      mirrorEligible: true,
      installEligible: true,
      activationEligible: true,
    },
  };
}

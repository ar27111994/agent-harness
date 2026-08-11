import { isPublisherVerifiedForAuthorityTier } from "./source-metadata.js";
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

const FIXTURE_UPDATED_AT = "2025-01-15T12:00:00.000Z";
const FIXTURE_GENERATED_AT = "2025-01-14T12:00:00.000Z";

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
  manifestEntry?: string;
}

interface FixtureDemandProfileOptions extends Partial<
  DemandProfile["signals"]
> {
  manifestFileName?: string;
  manifestPath?: string;
  readmeFileName?: string;
  readmePath?: string;
}

/**
 * Builds recommendation fixtures from the provided inputs.
 */
export function buildRecommendationFixtures(): RecommendationEvaluationFixture[] {
  return [
    buildBackendIntegrationFixture(),
    buildFrontendQualityFixture(),
    buildInfraSecurityFixture(),
    buildPythonApiPrecisionFixture(),
    buildLaravelWebStackFixture(),
    buildNoisyDocsNarrowRuntimeFixture(),
    buildLocalAvailabilitySeparationFixture(),
    buildSharedExecutableBiasFixture(),
    buildSharedSourceSaturationFixture(),
    buildFalsePositiveSuppressionFixture(),
    buildDependencySelfEchoFixture(),
    buildEcosystemExactStackFixture(),
    buildDesignToolRecallFixture(),
    buildNativeHostPolicyFixture(),
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

function buildPythonApiPrecisionFixture(): RecommendationEvaluationFixture {
  return {
    schemaVersion: 1,
    id: "python-api-precision",
    description:
      "Python API workspaces should keep exact framework/testing assets above broad backend or docs overlap.",
    demandProfile: createDemandProfile({
      languages: ["python"],
      packageManagers: ["poetry"],
      frameworks: ["fastapi"],
      concerns: ["backend", "testing", "docs"],
      tooling: ["python", "pytest", "pydantic"],
      manifestFileName: "pyproject.toml",
      manifestPath: "pyproject.toml",
    }),
    catalogEntries: [
      createAsset("fastapi-api-instruction", {
        assetKind: "instruction",
        hosts: ["copilot-vscode", "opencode"],
        capabilities: ["fastapi", "python", "backend", "pydantic"],
        sourceId: "python-api-foundation",
        publisher: "python-api-foundation",
        authorityTier: "official-first-party",
      }),
      createAsset("pytest-quality-skill", {
        assetKind: "skill",
        hosts: ["copilot-vscode", "opencode"],
        capabilities: ["pytest", "python", "testing", "fastapi"],
        sourceId: "python-quality-lab",
        publisher: "python-quality-lab",
      }),
      createAsset("generic-backend-agent", {
        assetKind: "agent",
        hosts: ["copilot-vscode", "opencode"],
        capabilities: ["backend", "integration", "automation", "service"],
        sourceId: "general-platform-lab",
        publisher: "general-platform-lab",
      }),
      createAsset("docs-reference-pack", {
        assetKind: "reference-pack",
        hosts: ["copilot-vscode", "opencode"],
        capabilities: ["docs", "reference", "guide", "backend"],
        sourceId: "docs-foundry",
        publisher: "docs-foundry",
        authorityTier: "official-compatible",
      }),
    ],
    expectations: [
      {
        host: "copilot-vscode",
        requiredAssetIds: ["fastapi-api-instruction", "pytest-quality-skill"],
        requiredAssetKinds: [
          { assetKind: "instruction", minimum: 1 },
          { assetKind: "skill", minimum: 1 },
        ],
        maxPerSourceFamily: 2,
        requiredConcerns: ["backend", "testing"],
        rankedAbove: [
          {
            higherAssetId: "fastapi-api-instruction",
            lowerAssetId: "generic-backend-agent",
          },
          {
            higherAssetId: "pytest-quality-skill",
            lowerAssetId: "generic-backend-agent",
          },
        ],
      },
      {
        host: "opencode",
        requiredAssetIds: ["fastapi-api-instruction", "pytest-quality-skill"],
        requiredAssetKinds: [
          { assetKind: "instruction", minimum: 1 },
          { assetKind: "skill", minimum: 1 },
        ],
        maxPerSourceFamily: 2,
        requiredConcerns: ["backend", "testing"],
      },
    ],
  };
}

function buildLaravelWebStackFixture(): RecommendationEvaluationFixture {
  return {
    schemaVersion: 1,
    id: "laravel-web-stack",
    description:
      "Laravel web app workspaces should favor exact PHP/Laravel assets over generic web or marketing overlap.",
    demandProfile: createDemandProfile({
      languages: ["php"],
      packageManagers: ["composer"],
      frameworks: ["laravel"],
      concerns: ["backend", "frontend", "testing"],
      tooling: ["php", "composer", "phpunit"],
      manifestFileName: "composer.json",
      manifestPath: "composer.json",
    }),
    catalogEntries: [
      createAsset("laravel-app-instruction", {
        assetKind: "instruction",
        hosts: ["copilot-vscode", "opencode"],
        capabilities: ["laravel", "php", "backend", "frontend"],
        sourceId: "php-foundation",
        publisher: "php-foundation",
        authorityTier: "official-first-party",
      }),
      createAsset("phpunit-testing-skill", {
        assetKind: "skill",
        hosts: ["copilot-vscode", "opencode"],
        capabilities: ["phpunit", "testing", "php", "laravel"],
        sourceId: "qa-lab",
        publisher: "qa-lab",
      }),
      createAsset("generic-web-agent", {
        assetKind: "agent",
        hosts: ["copilot-vscode", "opencode"],
        capabilities: ["frontend", "backend", "integration", "automation"],
        sourceId: "web-platform-lab",
        publisher: "web-platform-lab",
      }),
      createAsset("seo-marketing-skill", {
        assetKind: "skill",
        hosts: ["copilot-vscode", "opencode"],
        capabilities: ["seo", "content", "marketing", "brand"],
        sourceId: "growth-lab",
        publisher: "growth-lab",
        portfolioFit: 0.2,
        hostFit: 0.3,
      }),
    ],
    expectations: [
      {
        host: "copilot-vscode",
        requiredAssetIds: ["laravel-app-instruction", "phpunit-testing-skill"],
        requiredAssetKinds: [
          { assetKind: "instruction", minimum: 1 },
          { assetKind: "skill", minimum: 1 },
        ],
        maxPerSourceFamily: 2,
        requiredConcerns: ["backend", "frontend", "testing"],
        rankedAbove: [
          {
            higherAssetId: "laravel-app-instruction",
            lowerAssetId: "generic-web-agent",
          },
          {
            higherAssetId: "phpunit-testing-skill",
            lowerAssetId: "seo-marketing-skill",
          },
        ],
      },
      {
        host: "opencode",
        requiredAssetIds: ["laravel-app-instruction", "phpunit-testing-skill"],
        requiredAssetKinds: [
          { assetKind: "instruction", minimum: 1 },
          { assetKind: "skill", minimum: 1 },
        ],
        maxPerSourceFamily: 2,
        requiredConcerns: ["backend", "testing"],
      },
    ],
  };
}

function buildNoisyDocsNarrowRuntimeFixture(): RecommendationEvaluationFixture {
  return {
    schemaVersion: 1,
    id: "noisy-docs-narrow-runtime",
    description:
      "Docs-heavy workspaces with a narrow runtime stack should still rank exact runtime assets above broad docs/integration overlap.",
    demandProfile: createDemandProfile({
      languages: ["rust"],
      packageManagers: ["cargo"],
      frameworks: ["rust-cli"],
      concerns: ["docs", "automation", "integration"],
      tooling: ["rust", "cargo", "cli"],
      manifestFileName: "Cargo.toml",
      manifestPath: "Cargo.toml",
    }),
    catalogEntries: [
      createAsset("rust-cli-instruction", {
        assetKind: "instruction",
        hosts: ["copilot-vscode", "opencode"],
        capabilities: ["rust-cli", "rust", "cargo", "cli"],
        sourceId: "rust-foundation",
        publisher: "rust-foundation",
        authorityTier: "official-first-party",
      }),
      createAsset("cargo-testing-skill", {
        assetKind: "skill",
        hosts: ["copilot-vscode", "opencode"],
        capabilities: ["cargo", "rust", "testing", "cli"],
        sourceId: "rust-quality-lab",
        publisher: "rust-quality-lab",
      }),
      createAsset("generic-docs-automation-agent", {
        assetKind: "agent",
        hosts: ["copilot-vscode", "opencode"],
        capabilities: ["docs", "automation", "integration", "guide"],
        sourceId: "docs-ops-lab",
        publisher: "docs-ops-lab",
      }),
      createAsset("broad-cloud-workflow", {
        assetKind: "workflow",
        hosts: ["copilot-vscode", "opencode"],
        capabilities: ["integration", "automation", "workflow", "cloud"],
        sourceId: "general-cloud-lab",
        publisher: "general-cloud-lab",
      }),
    ],
    expectations: [
      {
        host: "copilot-vscode",
        requiredAssetIds: ["rust-cli-instruction", "cargo-testing-skill"],
        requiredAssetKinds: [
          { assetKind: "instruction", minimum: 1 },
          { assetKind: "skill", minimum: 1 },
        ],
        maxPerSourceFamily: 2,
        rankedAbove: [
          {
            higherAssetId: "rust-cli-instruction",
            lowerAssetId: "generic-docs-automation-agent",
          },
          {
            higherAssetId: "cargo-testing-skill",
            lowerAssetId: "broad-cloud-workflow",
          },
        ],
      },
      {
        host: "opencode",
        requiredAssetIds: ["rust-cli-instruction", "cargo-testing-skill"],
        requiredAssetKinds: [
          { assetKind: "instruction", minimum: 1 },
          { assetKind: "skill", minimum: 1 },
        ],
        maxPerSourceFamily: 2,
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

function buildFalsePositiveSuppressionFixture(): RecommendationEvaluationFixture {
  return {
    schemaVersion: 1,
    id: "false-positive-suppression",
    description:
      "Broad security and platform signals should not leak unrelated Firebase, Power Platform, Azure, or Kubernetes assets into the top results.",
    demandProfile: createDemandProfile({
      frameworks: ["node-backend"],
      concerns: [
        "security",
        "integration",
        "platform-engineering",
        "documentation",
      ],
      tooling: ["node", "typescript", "eslint", "npm"],
    }),
    catalogEntries: [
      createAsset("workspace-security-instruction", {
        assetKind: "instruction",
        hosts: ["copilot-vscode", "opencode"],
        capabilities: ["security", "node", "typescript", "integration"],
        sourceId: "devtools-foundry",
        publisher: "devtools-foundry",
        authorityTier: "official-first-party",
      }),
      createAsset("workspace-docs-skill", {
        assetKind: "skill",
        hosts: ["copilot-vscode", "opencode"],
        capabilities: ["documentation", "typescript", "linting", "security"],
        sourceId: "docs-foundry",
        publisher: "docs-foundry",
      }),
      createAsset("workspace-node-agent", {
        assetKind: "agent",
        hosts: ["copilot-vscode", "opencode"],
        capabilities: ["node", "backend", "integration", "testing"],
        sourceId: "service-lab",
        publisher: "service-lab",
      }),
      createAsset("false-firebase-security", {
        assetKind: "instruction",
        hosts: ["copilot-vscode", "opencode"],
        capabilities: ["firebase", "security", "rules", "integration"],
        sourceId: "firebase-suite",
        publisher: "firebase-suite",
        authorityTier: "official-compatible",
      }),
      createAsset("false-power-platform", {
        assetKind: "agent",
        hosts: ["copilot-vscode", "opencode"],
        capabilities: ["power", "platform", "security", "integration"],
        sourceId: "power-suite",
        publisher: "power-suite",
        authorityTier: "official-compatible",
      }),
      createAsset("false-azure-security", {
        assetKind: "agent",
        hosts: ["copilot-vscode", "opencode"],
        capabilities: ["azure", "security", "platform", "integration"],
        sourceId: "azure-suite",
        publisher: "azure-suite",
        authorityTier: "official-first-party",
      }),
      createAsset("false-kubernetes-platform", {
        assetKind: "plugin",
        hosts: ["copilot-vscode", "opencode"],
        capabilities: ["kubernetes", "platform", "security", "integration"],
        sourceId: "kube-suite",
        publisher: "kube-suite",
      }),
    ],
    expectations: [
      {
        host: "copilot-vscode",
        requiredAssetIds: [
          "workspace-security-instruction",
          "workspace-docs-skill",
          "workspace-node-agent",
        ],
        forbiddenTopAssetIds: [
          "false-firebase-security",
          "false-power-platform",
          "false-azure-security",
          "false-kubernetes-platform",
        ],
        requiredConcerns: ["security", "documentation"],
      },
    ],
  };
}

function buildDependencySelfEchoFixture(): RecommendationEvaluationFixture {
  return {
    schemaVersion: 1,
    id: "dependency-self-echo",
    description:
      "Installed package evidence should not cause the same package-registry asset to echo back into top recommendations.",
    demandProfile: createDemandProfile({
      concerns: ["data", "integration"],
      tooling: ["npm:@duckdb/node-api", "duckdb", "node", "typescript"],
    }),
    catalogEntries: [
      createAsset("duckdb-domain-skill", {
        assetKind: "skill",
        hosts: ["copilot-vscode", "opencode"],
        capabilities: ["duckdb", "data", "analytics", "integration"],
        sourceId: "data-lab",
        publisher: "data-lab",
      }),
      createAsset("duckdb-mcp-server", {
        assetKind: "mcp-server",
        hosts: ["shared"],
        capabilities: ["duckdb", "data", "integration", "mcp"],
        sourceId: "shared-data-tools",
        publisher: "shared-data-tools",
        authorityTier: "official-compatible",
      }),
      createAsset("duckdb-package-self-echo", {
        assetKind: "plugin",
        hosts: ["copilot-vscode", "opencode"],
        capabilities: ["duckdb", "node", "data", "package"],
        sourceId: "npm-registry",
        publisher: "npm-registry",
        sourceKind: "package-registry",
        compatibilityMode: "adaptable",
        manifestEntry: "@duckdb/node-api",
      }),
    ],
    expectations: [
      {
        host: "copilot-vscode",
        requiredAssetIds: ["duckdb-domain-skill"],
        forbiddenTopAssetIds: ["duckdb-package-self-echo"],
      },
    ],
  };
}

function buildEcosystemExactStackFixture(): RecommendationEvaluationFixture {
  return {
    schemaVersion: 1,
    id: "ecosystem-exact-stack-gates",
    description:
      "A TypeScript npm workspace declaring @duckdb/node-api and c8 must rank the declared DuckDB asset above off-ecosystem name-token lookalikes (a Rust node-cli crate, a c8-named VS Code theme) — the #443/#444 regression class the evaluate gate must catch.",
    demandProfile: createDemandProfile({
      languages: ["typescript"],
      packageManagers: ["npm"],
      frameworks: ["node-cli"],
      concerns: ["data"],
      tooling: ["npm:@duckdb/node-api", "npm:c8"],
    }),
    catalogEntries: [
      createAsset("duckdb-skill", {
        assetKind: "skill",
        hosts: ["copilot-vscode", "opencode"],
        capabilities: ["duckdb", "data", "analytics", "sql"],
        sourceId: "official-index:duckdb",
        publisher: "duckdb",
        authorityTier: "official-first-party",
      }),
      createAsset("cargo-node-cli", {
        assetKind: "skill",
        hosts: ["copilot-vscode", "opencode"],
        capabilities: ["node-cli", "node", "cli"],
        sourceId: "cargo-registry",
        sourceKind: "package-registry",
        publisher: "crates-io",
      }),
      createAsset("vscode-raw-theme", {
        assetKind: "extension",
        hosts: ["copilot-vscode"],
        capabilities: ["c8", "theme", "color"],
        sourceId: "vscode-marketplace",
        publisher: "raw-themes",
      }),
      createAsset("npm-duckdb-api", {
        assetKind: "skill",
        hosts: ["copilot-vscode"],
        capabilities: ["duckdb", "node", "api"],
        sourceId: "npm-registry",
        sourceKind: "package-registry",
        publisher: "duckdb",
        manifestEntry: "duckdb",
      }),
      // Review: the official-index source-family class. A WordPress-family
      // skill whose capabilities contain a generic term (`api`) must NOT
      // receive exact-stack credit in a TypeScript workspace — the policy
      // synonym table canonicalizes `api` → `node-backend`, and without the
      // source-family language gate this asset ranks exact-stack and crowds
      // the top (the #443 AC3 live repro).
      createAsset("wordpress-plugin-dev", {
        assetKind: "plugin",
        hosts: ["copilot-vscode", "opencode"],
        capabilities: ["wordpress", "wp", "development", "api", "security"],
        sourceId: "official-index:WordPress",
        publisher: "WordPress",
      }),
      // Filler: a realistic TypeScript ecosystem makes the top-10 assertion
      // meaningful (with 13 entries every candidate is top-10 by
      // construction — the fixture doctrine requires catalogs large enough
      // that forbidden-top-N expectations are not trivially saturated).
      // Capabilities are per-filler distinct so duplicate/redundancy
      // grouping does not stack penalties and skew the ranking.
      ...Array.from({ length: 12 }, (_, index) =>
        createAsset(`ts-ecosystem-skill-${index}`, {
          assetKind: "skill",
          hosts: ["copilot-vscode", "opencode"],
          capabilities: [
            "typescript",
            "node",
            `framework-${index}`,
            `library-${index}`,
            `concern-${index}`,
          ],
          sourceId: "official-index:typescript-ecosystem",
          publisher: "typescript-ecosystem",
        }),
      ),
    ],
    expectations: [
      {
        host: "copilot-vscode",
        requiredAssetIds: ["duckdb-skill"],
        rankedAbove: [
          {
            higherAssetId: "npm-duckdb-api",
            lowerAssetId: "vscode-raw-theme",
          },
          {
            higherAssetId: "duckdb-skill",
            lowerAssetId: "wordpress-plugin-dev",
          },
        ],
        // The coincidence classes must not reach the top at all: the Rust
        // crate (ecosystem gate), the c8-named theme, and the WordPress
        // family skill (source-family language gate, review).
        forbiddenTopAssetIds: [
          "wordpress-plugin-dev",
          "cargo-node-cli",
          "vscode-raw-theme",
        ],
        requiredAssetKinds: [{ assetKind: "skill", minimum: 2 }],
      },
      {
        host: "opencode",
        rankedAbove: [
          {
            higherAssetId: "duckdb-skill",
            lowerAssetId: "wordpress-plugin-dev",
          },
        ],
      },
    ],
  };
}

function buildDesignToolRecallFixture(): RecommendationEvaluationFixture {
  return {
    schemaVersion: 1,
    id: "design-tool-recall",
    description:
      "Design-system and design-asset evidence should surface design collaboration tools such as Penpot above generic mobile noise.",
    demandProfile: createDemandProfile({
      frameworks: ["flutter"],
      concerns: ["design-assets", "design-systems", "frontend", "mobile"],
      tooling: ["flutter", "pub", "detector:design-system"],
    }),
    catalogEntries: [
      createAsset("penpot-design-skill", {
        assetKind: "skill",
        hosts: ["copilot-vscode", "opencode"],
        capabilities: ["penpot", "design", "design-systems", "frontend"],
        sourceId: "design-tools",
        publisher: "design-tools",
      }),
      createAsset("flutter-theme-skill", {
        assetKind: "skill",
        hosts: ["copilot-vscode", "opencode"],
        capabilities: ["flutter", "design-systems", "frontend", "mobile"],
        sourceId: "flutter-foundry",
        publisher: "flutter-foundry",
      }),
      createAsset("generic-mobile-mcp", {
        assetKind: "mcp-server",
        hosts: ["shared"],
        capabilities: ["mobile", "frontend", "mcp", "automation"],
        sourceId: "mobile-tools",
        publisher: "mobile-tools",
        authorityTier: "official-compatible",
      }),
      createAsset("generic-mobile-agent", {
        assetKind: "agent",
        hosts: ["copilot-vscode", "opencode"],
        capabilities: ["mobile", "android", "ios", "frontend"],
        sourceId: "mobile-tools",
        publisher: "mobile-tools",
      }),
    ],
    expectations: [
      {
        host: "copilot-vscode",
        requiredAssetIds: ["penpot-design-skill", "flutter-theme-skill"],
        forbiddenTopAssetIds: ["generic-mobile-agent"],
        requiredConcerns: ["frontend", "mobile"],
      },
    ],
  };
}

function buildNativeHostPolicyFixture(): RecommendationEvaluationFixture {
  return {
    schemaVersion: 1,
    id: "native-host-policy-coverage",
    description:
      "Native host policies should surface host-native assets, keep budgets valid, and prove Cursor, Zed, Claude Code, and Pi defaults with fixture coverage.",
    demandProfile: createDemandProfile({
      languages: ["typescript"],
      packageManagers: ["pnpm"],
      frameworks: ["nextjs", "node-backend"],
      concerns: [
        "frontend",
        "backend",
        "integration",
        "testing",
        "documentation",
        "mcp",
      ],
      tooling: ["typescript", "node", "playwright", "mcp"],
    }),
    catalogEntries: [
      createAsset("cursor-rule-instruction", {
        assetKind: "instruction",
        hosts: ["cursor"],
        capabilities: ["cursor", "rule", "frontend", "typescript"],
        sourceId: "cursor-official-rules",
        publisher: "cursor",
        authorityTier: "official-first-party",
      }),
      createAsset("cursor-plugin-agent", {
        assetKind: "agent",
        hosts: ["cursor"],
        capabilities: ["cursor", "plugin", "agent", "backend"],
        sourceId: "cursor-official-plugins",
        publisher: "cursor",
        authorityTier: "official-compatible",
      }),
      createAsset("cursor-command-prompt-pack", {
        assetKind: "prompt-pack",
        hosts: ["cursor"],
        capabilities: ["cursor", "command", "workflow", "testing"],
        sourceId: "cursor-official-prompts",
        publisher: "cursor",
        authorityTier: "official-compatible",
      }),
      createAsset("cursor-extension-reference", {
        assetKind: "extension",
        hosts: ["cursor"],
        capabilities: ["cursor", "extension", "typescript", "frontend"],
        sourceId: "cursor-marketplace",
        publisher: "cursor-marketplace",
        authorityTier: "official-marketplace",
        estimatedPromptWeight: 1,
      }),
      createAsset("zed-project-rules-instruction", {
        assetKind: "instruction",
        hosts: ["zed"],
        capabilities: ["zed", "rules", "frontend", "typescript"],
        sourceId: "zed-official-rules",
        publisher: "zed",
        authorityTier: "official-first-party",
      }),
      createAsset("zed-mcp-context-server", {
        assetKind: "mcp-server",
        hosts: ["zed"],
        capabilities: ["zed", "mcp", "integration", "backend"],
        sourceId: "zed-official-mcp",
        publisher: "zed",
        authorityTier: "official-compatible",
      }),
      createAsset("zed-reference-pack", {
        assetKind: "reference-pack",
        hosts: ["zed"],
        capabilities: ["zed", "reference", "documentation", "frontend"],
        sourceId: "zed-reference-docs",
        publisher: "zed-docs",
        authorityTier: "official-compatible",
      }),
      createAsset("claude-memory-instruction", {
        assetKind: "instruction",
        hosts: ["claude-code"],
        capabilities: ["claude", "memory", "backend", "typescript"],
        sourceId: "claude-official-memory",
        publisher: "anthropic",
        authorityTier: "official-first-party",
      }),
      createAsset("claude-subagent-agent", {
        assetKind: "agent",
        hosts: ["claude-code"],
        capabilities: ["claude", "subagent", "agent", "testing"],
        sourceId: "claude-official-agents",
        publisher: "anthropic",
        authorityTier: "official-first-party",
      }),
      createAsset("claude-command-workflow", {
        assetKind: "workflow",
        hosts: ["claude-code"],
        capabilities: ["claude", "command", "workflow", "integration"],
        sourceId: "claude-official-commands",
        publisher: "anthropic",
        authorityTier: "official-compatible",
      }),
      createAsset("claude-hook-reference", {
        assetKind: "hook",
        hosts: ["claude-code"],
        capabilities: ["claude", "hook", "testing", "automation"],
        sourceId: "claude-official-hooks",
        publisher: "anthropic",
        authorityTier: "official-compatible",
      }),
      createAsset("pi-system-context-instruction", {
        assetKind: "instruction",
        hosts: ["pi"],
        capabilities: ["pi", "system", "backend", "typescript"],
        sourceId: "pi-official-context",
        publisher: "pi",
        authorityTier: "official-first-party",
      }),
      createAsset("pi-skill", {
        assetKind: "skill",
        hosts: ["pi"],
        capabilities: ["pi", "skill", "testing", "typescript"],
        sourceId: "pi-official-skills",
        publisher: "pi",
        authorityTier: "official-compatible",
      }),
      createAsset("pi-prompt-pack", {
        assetKind: "prompt-pack",
        hosts: ["pi"],
        capabilities: ["pi", "prompt", "workflow", "documentation"],
        sourceId: "pi-official-prompts",
        publisher: "pi",
        authorityTier: "official-compatible",
      }),
      createAsset("pi-mcp-extension-noise", {
        assetKind: "mcp-server",
        hosts: ["pi"],
        capabilities: ["pi", "mcp", "extension", "generic"],
        sourceId: "pi-reference-noise",
        publisher: "pi-reference-noise",
        authorityTier: "trusted-community",
        portfolioFit: 0.2,
        hostFit: 0.2,
        estimatedPromptWeight: 5,
      }),
    ],
    expectations: [
      {
        host: "cursor",
        requiredAssetIds: [
          "cursor-rule-instruction",
          "cursor-plugin-agent",
          "cursor-command-prompt-pack",
        ],
        requiredAssetKinds: [
          { assetKind: "instruction", minimum: 1 },
          { assetKind: "agent", minimum: 1 },
          { assetKind: "prompt-pack", minimum: 1 },
          { assetKind: "extension", minimum: 1 },
        ],
        maxPerSourceFamily: 3,
        requiredConcerns: ["frontend", "backend", "testing"],
      },
      {
        host: "zed",
        requiredAssetIds: [
          "zed-project-rules-instruction",
          "zed-mcp-context-server",
          "zed-reference-pack",
        ],
        requiredAssetKinds: [
          { assetKind: "instruction", minimum: 1 },
          { assetKind: "mcp-server", minimum: 1 },
          { assetKind: "reference-pack", minimum: 1 },
        ],
        maxPerSourceFamily: 2,
        requiredConcerns: ["frontend", "integration", "documentation"],
      },
      {
        host: "claude-code",
        requiredAssetIds: [
          "claude-memory-instruction",
          "claude-subagent-agent",
          "claude-command-workflow",
          "claude-hook-reference",
        ],
        requiredAssetKinds: [
          { assetKind: "instruction", minimum: 1 },
          { assetKind: "agent", minimum: 1 },
          { assetKind: "workflow", minimum: 1 },
          { assetKind: "hook", minimum: 1 },
        ],
        maxPerSourceFamily: 4,
        requiredConcerns: ["backend", "testing", "integration"],
      },
      {
        host: "pi",
        requiredAssetIds: [
          "pi-system-context-instruction",
          "pi-skill",
          "pi-prompt-pack",
        ],
        requiredAssetKinds: [
          { assetKind: "instruction", minimum: 1 },
          { assetKind: "skill", minimum: 1 },
          { assetKind: "prompt-pack", minimum: 1 },
        ],
        requiredConcerns: ["backend", "testing", "documentation"],
        rankedAbove: [
          {
            higherAssetId: "pi-skill",
            lowerAssetId: "pi-mcp-extension-noise",
          },
          {
            higherAssetId: "pi-prompt-pack",
            lowerAssetId: "pi-mcp-extension-noise",
          },
        ],
      },
    ],
  };
}

/**
 * Builds a normalized demand profile fixture with sensible defaults for omitted signal families.
 */
export function createDemandProfile(
  overrides: FixtureDemandProfileOptions,
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
      languages: overrides.languages ?? ["typescript"],
      packageManagers: overrides.packageManagers ?? ["npm"],
      frameworks: overrides.frameworks ?? [],
      concerns: overrides.concerns ?? [],
      tooling: overrides.tooling ?? [],
    },
    evidence: [
      {
        path: overrides.manifestPath ?? "package.json",
        fileName: overrides.manifestFileName ?? "package.json",
        matchedSignals: {
          languages: overrides.languages ?? ["typescript"],
          packageManagers: overrides.packageManagers ?? ["npm"],
          frameworks: overrides.frameworks ?? [],
          concerns: overrides.concerns ?? [],
          tooling: overrides.tooling ?? [],
        },
      },
      {
        path: overrides.readmePath ?? "README.md",
        fileName: overrides.readmeFileName ?? "README.md",
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
      publisherVerified: isPublisherVerifiedForAuthorityTier(
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
      manifestEntry: options.manifestEntry,
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

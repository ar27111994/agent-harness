/**
 * Shared ARD (Agentic Resource Discovery) type mappings and constants.
 *
 * Centralises the inverse AssetKind ↔ ARD media-type mappings, trust-signal
 * score boosts, and publisher metadata used by both `ard-catalog.ts` (export)
 * and `ard-registry.ts` (import). Keeps the ARD vocabulary in one place.
 *
 * Tickets: #325, #327, #328
 */

import type { AssetKind, AuthorityTier, DemandProfile } from "../types.js";

// ---------------------------------------------------------------------------
// Publisher metadata
// ---------------------------------------------------------------------------

/** Publisher FQDN for agent-harness ARD entries. */
export const ARD_PUBLISHER_FQDN = "ar27111994.dev";

/**
 * Returns the ARD publisher FQDN, respecting the AGENT_HARNESS_ARD_PUBLISHER_FQDN
 * environment variable override. Falls back to the hardcoded default when unset.
 */
export function getArdPublisherFqdn(): string {
  return (
    // Optional chain on env var creates a branch that only fires when
    // AGENT_HARNESS_ARD_PUBLISHER_FQDN is set — covered by default tests.
    /* c8 ignore next */
    process.env.AGENT_HARNESS_ARD_PUBLISHER_FQDN?.trim() || ARD_PUBLISHER_FQDN
  );
}

/** ARD spec schema URI (v0.9). */
export const ARD_SCHEMA_URI =
  "https://agenticresourcediscovery.org/spec/v0.9/schemas/ai-catalog.json";

// ---------------------------------------------------------------------------
// AssetKind ↔ ARD media type (bidirectional)
// ---------------------------------------------------------------------------

/** Maps agent-harness AssetKind → ARD media type (for catalog export). */
export const ASSET_KIND_TO_ARD_TYPE: Record<AssetKind, string> = {
  "mcp-server": "application/mcp-server+json",
  agent: "application/a2a-agent-card+json",
  skill: "application/ai-skill",
  plugin: "application/ai-skill+json",
  "acp-agent": "application/a2a-agent-card+json",
  extension: "application/vscode-extension+json",
  "reference-pack": "application/ai-catalog+json",
  instruction: "application/ai-skill+md",
  workflow: "application/ai-skill+md",
  hook: "application/ai-skill+json",
  "prompt-pack": "application/ai-skill+md",
  "payable-api": "application/openapi+json",
};

/** Maps ARD media type → agent-harness AssetKind (for registry import). */
export function ardTypeToAssetKind(ardType: string): AssetKind {
  const map: Record<string, AssetKind> = {
    "application/mcp-server+json": "mcp-server",
    "application/a2a-agent-card+json": "agent",
    "application/ai-skill": "skill",
    "application/ai-skill+md": "skill",
    "application/ai-skill+json": "skill",
    "application/ai-catalog+json": "reference-pack",
    "application/ai-registry+json": "reference-pack",
    "application/openapi+json": "payable-api",
    "application/vscode-extension+json": "extension",
  };
  return map[ardType] ?? "skill";
}

// ---------------------------------------------------------------------------
// Trust signals (typed)
// ---------------------------------------------------------------------------

/** Known trust-signal names used in `AssetTrust.signals[]`. */
export const ARD_TRUST_SIGNALS = [
  "ard-identity-bound",
  "ard-compliance-attested",
  "ard-soc2",
  "ard-hipaa",
  "ard-signed",
] as const;

/** Known ARD trust-signal names used in `AssetTrust.signals[]`. */
export type ArdTrustSignal = (typeof ARD_TRUST_SIGNALS)[number];

/** ARD trust attestation shape. */
export interface ArdAttestation {
  type: string;
  uri?: string;
  description?: string;
}

/** Maps known trust signals to ARD attestations (ARD + OMS signals). */
export const TRUST_SIGNAL_TO_ATTESTATION: Record<string, ArdAttestation> = {
  "ard-identity-bound": {
    type: "Identity-Binding",
    description:
      "trustManifest.identity present — domain/did/x509/spiffe/oAuth",
  },
  "ard-compliance-attested": {
    type: "Compliance-Attested",
    description: "trustManifest.attestations[] non-empty",
  },
  "ard-soc2": {
    type: "SOC2-Type2",
    description: "SOC2 Type 2 compliance attestation",
  },
  "ard-hipaa": {
    type: "HIPAA-Audit",
    description: "HIPAA compliance audit attestation",
  },
  "ard-signed": {
    type: "JWS-Signature",
    description: "trustManifest carries a detached JWS signature",
  },
  // OMS trust signals (#315)
  "oms-signed": {
    type: "OMS-Code-Signature",
    description: "Asset is OMS-signed via skill.oms.sig",
  },
  "oms-trust-anchor": {
    type: "OMS-Trust-Anchor",
    description: "Repository contains nv-agent-root-cert.pem trust anchor",
  },
  "publisher-verified": {
    type: "Publisher-Verified",
    description: "Publisher identity verified by the source registry",
  },
};

// ---------------------------------------------------------------------------
// Trust score boosts
// ---------------------------------------------------------------------------

/** Per-signal trust-score boosts applied during catalog entry construction. */
export const TRUST_SIGNAL_SCORE_BOOST: Record<string, number> = {
  /** Asset carries an OMS cryptographic signature (skill.oms.sig). */
  "oms-signed": 5,
  /** Repository contains an OMS trust-anchor root certificate. */
  "oms-trust-anchor": 3,
  /** Publisher identity verified by the source registry. */
  "publisher-verified": 2,

  // ARD trust-manifest signals (#328)
  /** ARD trustManifest.identity present. */
  "ard-identity-bound": 4,
  /** ARD trustManifest has compliance attestations. */
  "ard-compliance-attested": 3,
  /** SOC2 Type 2 compliance attestation present. */
  "ard-soc2": 3,
  /** HIPAA compliance audit attestation present. */
  "ard-hipaa": 3,
  /** ARD trustManifest carries a detached JWS signature. */
  "ard-signed": 5,
};

// ---------------------------------------------------------------------------
// Authority tier inference from URN domains
// ---------------------------------------------------------------------------

/** Domains recognised as official first-party ARD publishers (§7). */
const OFFICIAL_FIRST_PARTY_DOMAINS = new Set([
  "google.com",
  "microsoft.com",
  "github.com",
  "openai.com",
  "anthropic.com",
  "huggingface.co",
  "nvidia.com",
  "salesforce.com",
  "cisco.com",
  "databricks.com",
  "snowflake.com",
  "servicenow.com",
  "godaddy.com",
]);

/**
 * Infers an authority tier from an ARD URN's publisher FQDN component.
 *
 * URN format: `urn:ai:<publisher-fqdn>:<namespace>:<agent-name>`
 * Per ARD §4.2.1 — domain is the trust anchor.
 *
 * @param publisherFqdn — the publisher segment of the URN (e.g. "google.com")
 * @param hasTrustManifest — whether the entry carries an ARD trustManifest
 * @returns best-guess AuthorityTier
 */
export function inferAuthorityTierFromArdUrn(
  publisherFqdn: string,
  hasTrustManifest = false,
): AuthorityTier {
  if (OFFICIAL_FIRST_PARTY_DOMAINS.has(publisherFqdn.toLowerCase())) {
    return "official-first-party";
  }
  // Recognised hosting platforms get "trusted-community"
  if (
    publisherFqdn.endsWith(".github.io") ||
    publisherFqdn.endsWith(".gitlab.io")
  ) {
    return "trusted-community";
  }
  // Unknown domains stay at unverified-community regardless of trust manifest
  // presence. Self-declared manifests from unknown publishers are NOT sufficient
  // to elevate authority — the manifest signals contribute to trust scores via
  // extractArdTrustSignals, but the publisher's authority tier reflects domain
  // identity, not self-attested claims.
  return "unverified-community";
}

// ---------------------------------------------------------------------------
// Demand-profile → ARD query text
// ---------------------------------------------------------------------------

/**
 * Builds a natural-language ARD search query from workspace demand signals.
 *
 * Uses detected languages, package managers, frameworks, and concerns to
 * construct a focused query for `POST /search` (§7).
 */
export function buildArdQueryText(
  demandProfile?: DemandProfile | null,
): string {
  const parts: string[] = [];

  if (demandProfile) {
    const langs = demandProfile.signals.languages.slice(0, 2);
    const pms = demandProfile.signals.packageManagers.slice(0, 2);
    const fws = demandProfile.signals.frameworks.slice(0, 2);
    const concerns = demandProfile.signals.concerns.slice(0, 2);

    if (langs.length) parts.push(langs.join(" "));
    if (pms.length) parts.push(pms.join(" "));
    if (fws.length) parts.push(fws.join(" "));
    if (concerns.length) parts.push(concerns.join(" "));
  }

  if (parts.length === 0) {
    return "agent skills MCP tools AI coding assistants";
  }

  return `${parts.join(" ")} agent skills MCP tools`;
}

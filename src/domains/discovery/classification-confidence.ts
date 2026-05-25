import type { AssetKind } from "../../types.js";

/**
 * Defines the strength of one classification evidence item.
 */
export type ClassificationEvidenceStrength = "strong" | "medium" | "weak";

/**
 * Describes one evidence item behind an asset-kind classification.
 */
export interface ClassificationEvidenceItem {
  source: string;
  strength: ClassificationEvidenceStrength;
  detail: string;
}

/**
 * Describes an evidence-weighted asset-kind classification.
 */
export interface ClassificationConfidence {
  assetKind: AssetKind;
  confidence: number;
  level: ClassificationEvidenceStrength;
  evidence: ClassificationEvidenceItem[];
}

const CLASSIFICATION_EVIDENCE_WEIGHTS: Record<
  ClassificationEvidenceStrength,
  number
> = {
  strong: 0.45,
  medium: 0.3,
  weak: 0.18,
};

/**
 * Builds an evidence-weighted confidence result for an asset-kind decision.
 */
export function buildClassificationConfidence(input: {
  assetKind: AssetKind;
  evidence: ClassificationEvidenceItem[];
}): ClassificationConfidence {
  const evidence =
    input.evidence.length > 0 ? input.evidence : [pathEvidence()];
  const rawScore = evidence.reduce(
    (score, item) => score + CLASSIFICATION_EVIDENCE_WEIGHTS[item.strength],
    0,
  );
  const confidence = Number(Math.min(1, rawScore).toFixed(2));

  return {
    assetKind: input.assetKind,
    confidence,
    level: classifyClassificationConfidence(confidence),
    evidence,
  };
}

/**
 * Builds a weak path-only classification evidence item.
 */
export function pathEvidence(
  detail = "matched path pattern",
): ClassificationEvidenceItem {
  return {
    source: "path",
    strength: "weak",
    detail,
  };
}

/**
 * Builds a medium source-family classification evidence item.
 */
export function sourceFamilyEvidence(
  detail = "matched source-family classifier",
): ClassificationEvidenceItem {
  return {
    source: "source-family",
    strength: "medium",
    detail,
  };
}

/**
 * Builds a strong schema-aware classification evidence item.
 */
export function schemaEvidence(
  detail = "matched known schema or manifest shape",
): ClassificationEvidenceItem {
  return {
    source: "schema",
    strength: "strong",
    detail,
  };
}

/**
 * Builds a strong frontmatter-driven classification evidence item.
 */
export function frontmatterEvidence(
  detail = "matched explicit frontmatter metadata",
): ClassificationEvidenceItem {
  return {
    source: "frontmatter",
    strength: "strong",
    detail,
  };
}

function classifyClassificationConfidence(
  score: number,
): ClassificationEvidenceStrength {
  if (score >= 0.75) {
    return "strong";
  }

  if (score >= 0.45) {
    return "medium";
  }

  return "weak";
}

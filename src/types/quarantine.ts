import type { MirrorIndexEntry } from "./mirror.js";

/**
 * Defines quarantine review action values.
 */
export type QuarantineReviewAction = "approved" | "rejected" | "pinned";

/**
 * Defines quarantine lifecycle transition values.
 */
export type QuarantineTransition =
  | "new-risky-asset"
  | "safe-to-risky"
  | "ownership-changed"
  | "prompt-injection-detected"
  | "prompt-injection-cleared"
  | "safer-update-available"
  | "installed-asset-became-risky"
  | "official-duplicate-supersedes-community"
  | "review-approved"
  | "review-rejected"
  | "review-pinned";

/**
 * Describes persisted quarantine review evidence.
 */
export interface QuarantineReviewDecision {
  schemaVersion: 1;
  reviewedAt: string;
  action: QuarantineReviewAction;
  assetId: string;
  mirrorId: string;
  reason: string;
  reviewer?: string;
  evidence: {
    previousStatus: MirrorIndexEntry["status"];
    nextStatus: MirrorIndexEntry["status"];
    upstreamUrl: string;
    authorityTier: MirrorIndexEntry["source"]["authorityTier"];
    publisher: string;
    publisherVerified: boolean;
    contentHash: string;
  };
}

/**
 * Describes one quarantine state report entry.
 */
export interface QuarantineStateEntry {
  assetId: string;
  mirrorId: string;
  currentState: MirrorIndexEntry["status"];
  reason: string;
  firstSeenAt: string;
  lastReviewedAt?: string;
  suggestedAction: "review" | "keep-quarantined" | "approve" | "reject" | "pin";
  transitions: QuarantineTransition[];
  upstreamUrl: string;
  authorityTier: MirrorIndexEntry["source"]["authorityTier"];
  publisher: string;
  publisherVerified: boolean;
  contentHash: string;
}

/**
 * Describes quarantine lifecycle state report data.
 */
export interface QuarantineStateReport {
  schemaVersion: 1;
  generatedAt: string;
  entries: QuarantineStateEntry[];
  summary: {
    quarantinedCount: number;
    approvedWithWarningCount: number;
    rejectedCount: number;
    pinnedCount: number;
    reviewRequiredCount: number;
  };
}

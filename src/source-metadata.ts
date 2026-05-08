import type { AuthorityTier } from "./types.js";

/**
 * Determines whether an authority tier should be treated as publisher-verified.
 */
export function isPublisherVerifiedForAuthorityTier(
  authorityTier: AuthorityTier,
): boolean {
  return (
    authorityTier !== "trusted-community" &&
    authorityTier !== "unverified-community"
  );
}

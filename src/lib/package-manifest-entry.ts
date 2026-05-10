const PACKAGE_MANIFEST_ENTRY_PREFIX_RE =
  /^(?:cargo|cocoapods|gem|go|gradle|maven|npm|nuget|packagist|pub|pypi|swift):/iu;

/**
 * Removes a supported package-manifest registry prefix from a signal/evidence value.
 */
export function stripPackageManifestEntryPrefix(value: string): string {
  return value.replace(PACKAGE_MANIFEST_ENTRY_PREFIX_RE, "");
}

/**
 * Extracts the manifest entry portion from a supported registry-prefixed value.
 */
export function extractPackageManifestEntry(value: string): string | null {
  const strippedValue = stripPackageManifestEntryPrefix(value);
  return strippedValue === value ? null : strippedValue;
}

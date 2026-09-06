import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

/**
 * Parses a version tag ("v1.2.3", "1.2.3", "-rc.N"/-beta suffixes) into its
 * numeric core for semver-order comparison. Returns null for non-version tags
 * (e.g. "v2.0.0-tag" participants, arbitrary refs) so they are ignored when
 * computing the latest released tag.
 */
function parseTagVersion(tag) {
  const value = String(tag).replace(/^v/u, "");
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z.-]+)?$/u.exec(value);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/**
 * Compares two [major, minor, patch] version triples. Returns <0, 0, or >0.
 */
function compareVersionTriples(a, b) {
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return 0;
}

function isPrereleaseTag(tag) {
  // "v2.1.0-rc.1" → "-rc.1"; a stable tag has no `-` suffix.
  return /^v?\d+\.\d+\.\d+-/u.test(tag);
}

/**
 * Returns the highest released STABLE version tag present in `tags` as a
 * [major, minor, patch] triple, or null when no parseable version tag exists.
 * Prerelease tags (`v2.1.0-rc.1`) are excluded: a stable release must be
 * allowed to follow its own release candidates, and an RC should not stand in
 * as the "latest released" version a stable manifest could regress against
 * (review / CodeRabbit: preserve prerelease precedence).
 */
function findLatestTagVersion(tags) {
  let latest = null;
  for (const tag of tags) {
    const parsed = parseTagVersion(tag);
    if (parsed === null) continue;
    // Prerelease tags (vX.Y.Z-*) are not released stable versions.
    if (isPrereleaseTag(tag)) continue;
    if (latest === null || compareVersionTriples(parsed, latest) > 0) {
      latest = parsed;
    }
  }
  return latest;
}

export function validateVersionSync(packageDocument, lockDocument, tags) {
  const packageVersion = packageDocument?.version;
  const lockfileVersion = lockDocument?.version;
  const rootPackageVersion = lockDocument?.packages?.[""]?.version;
  const errors = [];

  if (!packageVersion) {
    errors.push("package.json is missing a version field.");
  }

  if (!lockfileVersion) {
    errors.push("package-lock.json is missing a top-level version field.");
  }

  if (!rootPackageVersion) {
    errors.push("package-lock.json is missing packages[''].version.");
  }

  if (packageVersion && lockfileVersion && packageVersion !== lockfileVersion) {
    errors.push(
      `package.json version (${packageVersion}) does not match package-lock.json version (${lockfileVersion}).`,
    );
  }

  if (
    packageVersion &&
    rootPackageVersion &&
    packageVersion !== rootPackageVersion
  ) {
    errors.push(
      `package.json version (${packageVersion}) does not match package-lock.json packages[''].version (${rootPackageVersion}).`,
    );
  }

  // Tag-vs-manifest guard (#467): the manifest version must NOT regress below
  // the highest released tag. A FORWARD bump (manifest > latest tag) is the
  // normal pre-release state — the version is awaiting its post-merge tag
  // (the release action tags v<version> on main after merge). Exit 0 in that
  // state. The check fails only when the manifest is AT or BEHIND the latest
  // released tag without a matching tag of its own (a regression/re-tag, which
  // a pre-merge gate must reject).
  if (Array.isArray(tags) && tags.length > 0) {
    if (packageVersion && parseTagVersion(`v${packageVersion}`) !== null) {
      const hasMatchingTag = tags.some((tag) => tag === `v${packageVersion}`);
      const latestTagVersion = findLatestTagVersion(tags);
      if (!hasMatchingTag) {
        if (latestTagVersion === null) {
          // No parseable released tag existed yet; treat as a forward bump.
          // `version` is packageVersion directly: this branch is only reached
          // when packageVersion is truthy (the surrounding guard).
          return {
            ok: errors.length === 0,
            version: packageVersion,
            errors,
          };
        }
        const manifestTriple = parseTagVersion(`v${packageVersion}`);
        if (
          manifestTriple !== null &&
          compareVersionTriples(manifestTriple, latestTagVersion) <= 0
        ) {
          errors.push(
            `package.json version (${packageVersion}) does not exceed the latest released tag (v${latestTagVersion.join(".")}) and has no matching git tag on main — a version regression or retagged release.`,
          );
        }
      }
    }
  }

  return {
    ok: errors.length === 0,
    version: packageVersion ?? lockfileVersion ?? rootPackageVersion ?? null,
    errors,
  };
}

export function readJsonFile(jsonPath) {
  return JSON.parse(readFileSync(jsonPath, "utf8"));
}

/**
 * Enumerates the git tags reachable in the repository rooted at `cwd`.
 *
 * Returns an array of tag names when git is available and `cwd` is a git
 * repository, or `null` when the tag list cannot be determined (git missing,
 * non-repository directory, or a shallow checkout with no tags fetched).
 * Callers treat `null` as "cannot verify" and skip the tag-vs-manifest check.
 */
export function listGitTags(cwd) {
  try {
    const output = execFileSync("git", ["tag", "--list"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return output
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter(Boolean);
  } catch {
    return null;
  }
}

export function main(options = {}) {
  const cwd = options.cwd ?? process.cwd();
  const packagePath = resolve(cwd, "package.json");
  const lockfilePath = resolve(cwd, "package-lock.json");
  const packageDocument = readJsonFile(packagePath);
  const lockDocument = readJsonFile(lockfilePath);
  const tags = options.tags ?? listGitTags(cwd);
  const result = validateVersionSync(packageDocument, lockDocument, tags);

  if (!result.ok) {
    for (const error of result.errors) {
      console.error(error);
    }
    process.exitCode = 1;
    return result;
  }

  console.log(
    `package.json and package-lock.json versions are synchronized at ${result.version}`,
  );
  return result;
}

const isDirectExecution =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectExecution) {
  main();
}

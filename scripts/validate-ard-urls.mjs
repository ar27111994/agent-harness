/**
 * Validate ARD catalog URL quality.
 *
 * Reads .well-known/ai-catalog.json and verifies that at least 80% of
 * entries carry resolvable HTTP/HTTPS URLs rather than content-addressing
 * hashes or plain names. ARD 1.0 inline `data` entries are valid and are
 * counted separately from URL-backed entries.
 *
 * Tickets: #380
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

/** Minimum fraction of entries that must have HTTP/HTTPS URLs. */
const MIN_HTTP_FRACTION = 0.8;

/**
 * Returns true when `url` looks like an HTTP/HTTPS URL.
 */
function isHttpUrl(url) {
  return typeof url === "string" && /^https?:\/\//i.test(url);
}

/**
 * Returns true when `url` looks like a 40-char hex Git SHA.
 */
function isHashUrl(url) {
  return typeof url === "string" && /^[0-9a-f]{40}$/i.test(url);
}

export function validateArdUrls(catalogPath) {
  const errors = [];
  let raw;
  try {
    raw = readFileSync(catalogPath, "utf8");
  } catch (err) {
    errors.push(`Failed to read ai-catalog.json: ${err.message}`);
    return {
      ok: false,
      errors,
      stats: {
        total: 0,
        httpCount: 0,
        hashCount: 0,
        nameCount: 0,
        inlineDataCount: 0,
        missingCount: 0,
        invalidEntryCount: 0,
        fraction: 0,
      },
    };
  }
  let catalog;
  try {
    catalog = JSON.parse(raw);
  } catch (err) {
    errors.push(`Failed to parse ai-catalog.json: ${err.message}`);
    return {
      ok: false,
      errors,
      stats: {
        total: 0,
        httpCount: 0,
        hashCount: 0,
        nameCount: 0,
        inlineDataCount: 0,
        missingCount: 0,
        invalidEntryCount: 0,
        fraction: 0,
      },
    };
  }

  if (!Array.isArray(catalog.entries)) {
    errors.push("ai-catalog.json is missing or has no entries array.");
    return {
      ok: false,
      errors,
      stats: {
        total: 0,
        httpCount: 0,
        hashCount: 0,
        nameCount: 0,
        inlineDataCount: 0,
        missingCount: 0,
        invalidEntryCount: 0,
        fraction: 0,
      },
    };
  }

  const entries = catalog.entries;
  let httpCount = 0;
  let hashCount = 0;
  let nameCount = 0;
  let inlineDataCount = 0;
  let missingCount = 0;
  let invalidEntryCount = 0;

  for (const entry of entries) {
    if (entry == null || typeof entry !== "object") {
      invalidEntryCount++;
      continue;
    }
    const url = entry.url;
    const hasInlineData =
      entry.data !== null &&
      typeof entry.data === "object" &&
      !Array.isArray(entry.data);
    if (isHttpUrl(url)) {
      httpCount++;
    } else if (hasInlineData) {
      inlineDataCount++;
    } else if (!url) {
      missingCount++;
    } else if (isHashUrl(url)) {
      hashCount++;
    } else {
      nameCount++;
    }
  }

  if (invalidEntryCount > 0) {
    errors.push(
      `${invalidEntryCount} entries are null or non-object values — every ARD entry must be an object.`,
    );
  }

  const total = entries.length;
  const fraction = total > 0 ? httpCount / total : 0;

  if (fraction < MIN_HTTP_FRACTION) {
    errors.push(
      `ARD URL quality below threshold: ${httpCount}/${total} HTTP (${(fraction * 100).toFixed(1)}%)` +
        ` — minimum required: ${(MIN_HTTP_FRACTION * 100).toFixed(0)}%.` +
        ` Hash: ${hashCount}, Name: ${nameCount}, Inline data: ${inlineDataCount}, Missing: ${missingCount}.`,
    );
  }

  if (missingCount > 0) {
    errors.push(
      `${missingCount} entries have neither a usable url nor inline data — every ARD entry must have one of those fields.`,
    );
  }

  return {
    ok: errors.length === 0,
    errors,
    stats: {
      total,
      httpCount,
      hashCount,
      nameCount,
      inlineDataCount,
      missingCount,
      invalidEntryCount,
      fraction,
    },
  };
}

export function main(options = {}) {
  const cwd = options.cwd ?? process.cwd();
  const catalogPath = resolve(cwd, ".well-known", "ai-catalog.json");
  const result = validateArdUrls(catalogPath);

  if (!result.ok) {
    for (const error of result.errors) {
      console.error(error);
    }
    process.exitCode = 1;
    return result;
  }

  const s = result.stats;
  console.log(
    `ARD URL quality: ${s.httpCount}/${s.total} HTTP (${(s.fraction * 100).toFixed(1)}%)` +
      ` — ${s.hashCount} hash, ${s.nameCount} name, ${s.inlineDataCount} inline data, ${s.missingCount} missing`,
  );
  return result;
}

const isDirectExecution =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);

// Deferred CLI entry: runs main() only when the script is invoked directly.
// Extracted so tests can control the argv-based guard without c8 ignores.
export function runCliIfDirect(guardValue, options) {
  if (guardValue) {
    return main(options);
  }
  return undefined;
}

runCliIfDirect(isDirectExecution);

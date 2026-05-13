import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

export function validateVersionSync(packageDocument, lockDocument) {
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

  return {
    ok: errors.length === 0,
    version: packageVersion ?? lockfileVersion ?? rootPackageVersion ?? null,
    errors,
  };
}

export function readJsonFile(jsonPath) {
  return JSON.parse(readFileSync(jsonPath, "utf8"));
}

export function main(options = {}) {
  const cwd = options.cwd ?? process.cwd();
  const packagePath = resolve(cwd, "package.json");
  const lockfilePath = resolve(cwd, "package-lock.json");
  const packageDocument = readJsonFile(packagePath);
  const lockDocument = readJsonFile(lockfilePath);
  const result = validateVersionSync(packageDocument, lockDocument);

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

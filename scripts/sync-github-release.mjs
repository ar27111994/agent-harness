import { resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { readJsonFile } from "./check-version-sync.mjs";
import {
  buildCombinedReleaseNotes,
  isPreRelease,
  normalizeVersionFromTag,
  readManualReleaseNotes,
} from "./release-notes.mjs";

const GITHUB_API_URL = "https://api.github.com";
const API_VERSION = "2022-11-28";
const DEFAULT_TIMEOUT_MS = 30_000;

export function getOptionValue(flagName, argv = process.argv) {
  const index = argv.indexOf(flagName);
  if (index === -1) {
    return undefined;
  }

  const value = argv[index + 1];
  if (value === undefined || value.startsWith("-")) {
    throw new Error(`Flag ${flagName} requires a value.`);
  }

  return value;
}

function getRequiredEnvironmentValue(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable ${name}.`);
  }
  return value;
}

function resolveReleaseContext() {
  const repo =
    getOptionValue("--repo") ??
    getRequiredEnvironmentValue("GITHUB_REPOSITORY");
  const tag =
    getOptionValue("--tag") ?? getRequiredEnvironmentValue("GITHUB_REF_NAME");
  const token =
    process.env.GITHUB_TOKEN ||
    process.env.GH_TOKEN ||
    getRequiredEnvironmentValue("GITHUB_TOKEN");
  const targetCommitish =
    getOptionValue("--target") ?? process.env.GITHUB_SHA ?? undefined;
  const version = normalizeVersionFromTag(tag);
  const packageDocument = readJsonFile(resolve(process.cwd(), "package.json"));

  if (packageDocument.version !== version) {
    throw new Error(
      `Release tag ${tag} does not match package.json version ${packageDocument.version}.`,
    );
  }

  return {
    repo,
    tag,
    token,
    targetCommitish,
    version,
    packageName: packageDocument.name,
  };
}

async function githubRequest({
  token,
  method,
  endpoint,
  body,
  tolerate404 = false,
  timeoutMs = DEFAULT_TIMEOUT_MS,
}) {
  const timeoutSignal = AbortSignal.timeout(timeoutMs);

  let response;
  try {
    response = await fetch(`${GITHUB_API_URL}${endpoint}`, {
      method,
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "User-Agent": "agent-harness",
        "X-GitHub-Api-Version": API_VERSION,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: timeoutSignal,
    });
  } catch (error) {
    if (
      error instanceof Error &&
      (error.name === "TimeoutError" || error.name === "AbortError")
    ) {
      throw new Error(
        `GitHub API ${method} ${endpoint} timed out after ${timeoutMs}ms.`,
        { cause: error },
      );
    }

    throw error;
  }

  if (tolerate404 && response.status === 404) {
    return null;
  }

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `GitHub API ${method} ${endpoint} failed (${response.status}): ${errorText}`,
    );
  }

  if (response.status === 204) {
    return null;
  }

  return response.json();
}

async function generateReleaseNotes(context) {
  const generated = await githubRequest({
    token: context.token,
    method: "POST",
    endpoint: `/repos/${context.repo}/releases/generate-notes`,
    body: {
      tag_name: context.tag,
      target_commitish: context.targetCommitish,
    },
  });

  const manualNotes = readManualReleaseNotes(process.cwd(), context.version);
  return buildCombinedReleaseNotes({
    manualNotes,
    generatedNotes: generated?.body ?? "",
  });
}

export function buildReleasePayload(context, combinedNotes, options = {}) {
  const payload = {
    tag_name: context.tag,
    target_commitish: context.targetCommitish,
    name: context.tag,
    body: combinedNotes,
    draft: false,
    prerelease: isPreRelease(context.version),
  };

  if (options.includeMakeLatest ?? true) {
    payload.make_latest = isPreRelease(context.version) ? "false" : "true";
  }

  return payload;
}

export async function syncGitHubRelease() {
  const context = resolveReleaseContext();
  const body = await generateReleaseNotes(context);
  const existingRelease = await githubRequest({
    token: context.token,
    method: "GET",
    endpoint: `/repos/${context.repo}/releases/tags/${context.tag}`,
    tolerate404: true,
  });

  if (existingRelease) {
    await githubRequest({
      token: context.token,
      method: "PATCH",
      endpoint: `/repos/${context.repo}/releases/${existingRelease.id}`,
      body: buildReleasePayload(context, body, { includeMakeLatest: false }),
    });
    console.log(
      `Updated GitHub release ${context.tag} for ${context.packageName}.`,
    );
    return;
  }

  await githubRequest({
    token: context.token,
    method: "POST",
    endpoint: `/repos/${context.repo}/releases`,
    body: buildReleasePayload(context, body),
  });
  console.log(
    `Created GitHub release ${context.tag} for ${context.packageName}.`,
  );
}

const isDirectExecution =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectExecution) {
  syncGitHubRelease().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}

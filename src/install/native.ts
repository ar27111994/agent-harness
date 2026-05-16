import { join } from "node:path";

import {
  executeExtensionInstallAction,
  formatExtensionInstallActions,
  type ExtensionInstallAction,
  type ExtensionInstallOperation,
  type NativeInstallResult,
} from "../host-adapters/extension-installer.js";
import {
  resolveHostAdapter,
  type HostAdapter,
} from "../host-adapters/registry.js";
import { getOptionValue } from "../lib/cli-options.js";
import {
  assertNoPreflightErrors,
  formatPreflightDiagnostics,
  runNativeInstallPreflight,
} from "../lib/preflight.js";
import { readJsonFileOrNull, writeJsonFile } from "../files.js";
import { assertAssetCatalogEntry } from "../manifest-validation.js";
import type {
  ActivationManifest,
  AssetCatalogEntry,
  CopilotWorkspaceProfileManifest,
} from "../types.js";
import { NATIVE_INSTALL_STATE_OUTPUT_PATH } from "./paths.js";
import { sanitizeAssetId } from "./utils.js";

type NativeInstallCliOperation = "plan" | ExtensionInstallOperation;

/**
 * Provides native install management for the lifecycle pipeline.
 */
export async function manageNativeInstall(
  projectRoot: string,
  args: string[],
): Promise<void> {
  const hostName = getOptionValue(args, "--host") ?? "vscode";
  const operation = parseNativeInstallOperation(
    getOptionValue(args, "--operation") ?? "plan",
  );
  const apply = args.includes("--apply");
  const adapter = resolveHostAdapter(hostName);

  if (!adapter) {
    throw new Error(`Unknown host '${hostName}' for native install.`);
  }

  if (!adapter.nativeInstall) {
    throw new Error(
      `${adapter.displayName} does not support host-native installation through agent-harness.`,
    );
  }

  const assets = await collectNativeInstallAssets(projectRoot, adapter);
  const actions = adapter.nativeInstall.collectActions(assets);

  if (actions.length === 0) {
    console.log(
      `No selected ${adapter.nativeInstall.assetKind} assets are ready for native install on ${adapter.displayName}.`,
    );
    return;
  }

  if (operation === "plan") {
    printNativeInstallPlan(adapter, actions);
    return;
  }

  if ((operation === "install" || operation === "remove") && !apply) {
    console.log(
      `Native ${operation} is mutating. Re-run with --apply to execute it.`,
    );
    printNativeInstallPlan(adapter, actions);
    return;
  }

  const diagnostics = await runNativeInstallPreflight(adapter);
  if (diagnostics.length > 0) {
    console.log(formatPreflightDiagnostics(diagnostics));
  }
  assertNoPreflightErrors(diagnostics);

  const results: NativeInstallResult[] = [];
  for (const action of actions) {
    const result = await executeExtensionInstallAction(action, operation);
    results.push(result);
    console.log(
      `${result.success ? "ok" : "failed"}: ${result.message} (${result.extensionId})`,
    );
  }

  await writeNativeInstallState(projectRoot, adapter, operation, results);

  const failedResults = results.filter((result) => !result.success);
  if (failedResults.length > 0) {
    throw new Error(
      `Native ${operation} failed for ${failedResults.length} extension(s).`,
    );
  }
}

async function collectNativeInstallAssets(
  projectRoot: string,
  adapter: HostAdapter,
): Promise<AssetCatalogEntry[]> {
  const nativeInstall = adapter.nativeInstall;
  if (!nativeInstall) {
    return [];
  }

  const assetIds = new Set<string>();
  const activationRoot = join(projectRoot, "activate", adapter.lifecycleHost);
  const profileManifest =
    await readJsonFileOrNull<CopilotWorkspaceProfileManifest>(
      join(activationRoot, "workspace-profile-manifest.json"),
    );
  for (const assetId of profileManifest?.selectedExtensionIds ?? []) {
    assetIds.add(assetId);
  }
  for (const assetId of profileManifest?.selectedAssetIds ?? []) {
    assetIds.add(assetId);
  }

  const activationManifest = await readJsonFileOrNull<ActivationManifest>(
    join(activationRoot, "activation-manifest.json"),
  );
  for (const assetId of activationManifest?.activeAssets ?? []) {
    assetIds.add(assetId);
  }

  const assets: AssetCatalogEntry[] = [];
  for (const assetId of assetIds) {
    const asset = await readJsonFileOrNull<AssetCatalogEntry>(
      join(activationRoot, sanitizeAssetId(assetId), "asset.json"),
      assertAssetCatalogEntry,
    );
    if (asset && asset.assetKind === nativeInstall.assetKind) {
      assets.push(asset);
    }
  }

  return assets.sort((left, right) => left.id.localeCompare(right.id));
}

function printNativeInstallPlan(
  adapter: HostAdapter,
  actions: ExtensionInstallAction[],
): void {
  console.log(`Native install plan for ${adapter.displayName}:`);
  for (const line of formatExtensionInstallActions(actions)) {
    console.log(`  ${line}`);
  }
}

async function writeNativeInstallState(
  projectRoot: string,
  adapter: HostAdapter,
  operation: ExtensionInstallOperation,
  results: NativeInstallResult[],
): Promise<void> {
  await writeJsonFile(join(projectRoot, ...NATIVE_INSTALL_STATE_OUTPUT_PATH), {
    schemaVersion: 1,
    updatedAt: new Date().toISOString(),
    host: adapter.id,
    operation,
    results,
  });
}

function parseNativeInstallOperation(value: string): NativeInstallCliOperation {
  if (
    value === "plan" ||
    value === "install" ||
    value === "verify" ||
    value === "remove"
  ) {
    return value;
  }

  throw new Error(
    `Invalid native install operation '${value}'. Must be one of: plan, install, verify, remove.`,
  );
}

/**
 * Exposes narrow native install internals for focused asset collection tests.
 */
export const installNativeInternals = {
  collectNativeInstallAssets,
  parseNativeInstallOperation,
};

import {
  listHostAdapters,
  resolveHostAdapter,
  type HostAdapter,
} from "./host-adapters/registry.js";
import { collectActivatedAssetPrerequisiteDiagnostics } from "./lib/asset-prerequisites.js";
import { getOptionValue } from "./lib/cli-options.js";
import {
  formatPreflightDiagnostics,
  runAdapterPreflight,
  runHostPreflight,
} from "./lib/preflight.js";

/**
 * Dispatches setup and doctor commands for host inventory and readiness checks.
 */
export async function runSetup(
  args: string[],
  projectRoot?: string,
): Promise<number> {
  const [command = "doctor", ...rest] = args;

  switch (command) {
    case "doctor":
      return (await runDoctor(rest, projectRoot)) ? 0 : 1;
    case "hosts":
      printHosts();
      return 0;
    case "help":
      printSetupHelp();
      return 0;
    default:
      printSetupHelp();
      return 1;
  }
}

/**
 * Prints adapter metadata and preflight diagnostics, returning whether all
 * required checks passed.
 */
async function runDoctor(
  args: string[],
  projectRoot: string | undefined,
): Promise<boolean> {
  const hostName = getOptionValue(args, "--host");

  const adapters = hostName
    ? [resolveHostAdapter(hostName)].filter(
        (adapter): adapter is HostAdapter => adapter !== null,
      )
    : listHostAdapters();

  if (adapters.length === 0) {
    console.log(`No registered host adapter matched '${hostName}'.`);
    return false;
  }

  let hasErrors = false;

  for (const adapter of adapters) {
    console.log(`\n# ${adapter.displayName} (${adapter.id})`);
    console.log(`Lifecycle host: ${adapter.lifecycleHost}`);
    console.log(`Recommendation host: ${adapter.recommendationHost}`);
    console.log(
      `Requires lifecycle host paths: ${adapter.requiresLifecycleHostPaths ?? adapter.mutatesHostPaths}`,
    );
    console.log(`Default bundles: ${adapter.defaultBundleIds.join(", ")}`);
    if (adapter.runtime) {
      console.log(`Runtime executable: ${adapter.runtime.executable}`);
      if (adapter.runtime.guidance) {
        console.log(`Runtime guidance: ${adapter.runtime.guidance}`);
      }
    }
    console.log("Capabilities:");
    for (const capability of adapter.capabilities) {
      console.log(
        `- ${capability.assetKind}: ${capability.behaviors.join(", ")}`,
      );
    }

    const diagnostics = [
      ...(await runHostPreflight(adapter.lifecycleHost, {
        requireHostPaths:
          adapter.requiresLifecycleHostPaths ?? adapter.mutatesHostPaths,
      })),
      ...(await runAdapterPreflight(adapter)),
      ...(projectRoot
        ? await collectActivatedAssetPrerequisiteDiagnostics(
            projectRoot,
            adapter,
            { missingEnvSeverity: "warning" },
          )
        : []),
    ];
    if (diagnostics.length > 0) {
      console.log(formatPreflightDiagnostics(diagnostics));
    }
    if (diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
      hasErrors = true;
    }
  }

  return !hasErrors;
}

function printHosts(): void {
  for (const adapter of listHostAdapters()) {
    console.log(
      `${adapter.id}\t${adapter.displayName}\taliases=${adapter.aliases.join(",")}`,
    );
  }
}

function printSetupHelp(): void {
  const hostNames = listHostAdapters()
    .flatMap((adapter) => [adapter.id, ...adapter.aliases])
    .sort((left, right) => left.localeCompare(right))
    .join("|");
  console.log(`setup commands:
  doctor        Check config, host readiness, capabilities, and guided setup notes
  hosts         List registered host adapters

Options:
  --host <${hostNames}>`);
}

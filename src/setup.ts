import {
  listHostAdapters,
  resolveHostAdapter,
  type HostAdapter,
} from "./host-adapters/registry.js";
import {
  formatPreflightDiagnostics,
  runHostPreflight,
} from "./lib/preflight.js";

export async function runSetup(args: string[]): Promise<number> {
  const [command = "doctor", ...rest] = args;

  switch (command) {
    case "doctor":
      return (await runDoctor(rest)) ? 0 : 1;
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

async function runDoctor(args: string[]): Promise<boolean> {
  const hostOptionIndex = args.indexOf("--host");
  const hostName = getOptionValue(args, "--host");
  if (hostOptionIndex !== -1 && !hostName) {
    console.log("Missing value for '--host'.");
    return false;
  }

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
    console.log("Capabilities:");
    for (const capability of adapter.capabilities) {
      console.log(
        `- ${capability.assetKind}: ${capability.behaviors.join(", ")}`,
      );
    }

    const diagnostics = await runHostPreflight(adapter.lifecycleHost, {
      requireHostPaths:
        adapter.requiresLifecycleHostPaths ?? adapter.mutatesHostPaths,
    });
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
  console.log(`setup commands:
  doctor        Check config, host readiness, capabilities, and guided setup notes
  hosts         List registered host adapters

Options:
  --host <vscode|opencode|cursor|zed|claude-code|pi>`);
}

function getOptionValue(
  args: string[],
  optionName: string,
): string | undefined {
  const optionIndex = args.indexOf(optionName);

  if (optionIndex === -1) {
    return undefined;
  }

  return args[optionIndex + 1];
}

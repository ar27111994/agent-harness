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
    case "login":
      printLoginGuidance(rest);
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

function printLoginGuidance(args: string[]): void {
  const provider = getOptionValue(args, "--provider") ?? args[0] ?? "github";
  const guidanceByProvider: Record<string, string[]> = {
    github: [
      "GitHub authentication improves discovery throughput for public and private repository sources.",
      "Create a least-privileged token at https://github.com/settings/tokens?type=beta or https://github.com/settings/tokens.",
      "Set GITHUB_PERSONAL_ACCESS_TOKEN or GITHUB_TOKEN in your shell, CI secret store, or local .env file.",
    ],
    npm: [
      "npm authentication is required only for package publication.",
      "Run npm login locally or configure NPM_TOKEN as a GitHub Actions secret for release publishing.",
    ],
    ai: [
      "Optional AI enrichment uses an OpenAI-compatible chat completions endpoint.",
      "Set AGENT_HARNESS_AI_ENRICHMENT_URL, AGENT_HARNESS_AI_ENRICHMENT_API_KEY, and optionally AGENT_HARNESS_AI_ENRICHMENT_MODEL.",
    ],
  };
  const guidance = guidanceByProvider[provider.toLowerCase()];
  if (!guidance) {
    console.log(
      `Unknown login provider '${provider}'. Known providers: ${Object.keys(guidanceByProvider).join(", ")}`,
    );
    return;
  }

  console.log(`# ${provider} login guidance`);
  for (const line of guidance) {
    console.log(`- ${line}`);
  }
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
  login         Print provider-specific login/OAuth guidance

Options:
  --host <${hostNames}>
  --provider <github|npm|ai>`);
}
